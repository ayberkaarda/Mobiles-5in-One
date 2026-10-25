using System.Globalization;
using FluentValidation;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Patika.Api.Features.Media;
using Patika.Api.Security.Authorization;
using Patika.Api.Validation;
using Patika.Contracts.Community;
using Patika.Contracts.Errors;
using Patika.Contracts.Geo;
using Patika.Contracts.Media;
using Patika.Contracts.Urgent;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Domain.Security;
using Patika.Infrastructure.Media;
using Patika.Infrastructure.Persistence;

namespace Patika.Api.Features.Urgent;

public static class UrgentRules
{
    public const int DailyPostCap = 3;
    public const int DefaultRadiusMeters = 2000;
    public const int MaxResults = 100;
    public const int MinDescription = 10;
    public const int MaxDescription = 1000;

    public static bool IsCategory(string? value) =>
        value is not null && Enum.TryParse<UrgentCategory>(value, ignoreCase: false, out var category)
        && Enum.IsDefined(category) && string.Equals(category.ToString(), value, StringComparison.Ordinal);

    public static bool IsUrgentPhotoKey(string? key) => MediaKeys.TryParse(key, out var kind, out _) && kind == "urgent";

    /// <summary>Open → Handled → Closed, or Open → Closed; never back to Open.</summary>
    public static bool CanMove(UrgentPostState from, UrgentPostState to) => (from, to) switch
    {
        (UrgentPostState.Open, UrgentPostState.Handled) => true,
        (UrgentPostState.Open, UrgentPostState.Closed) => true,
        (UrgentPostState.Handled, UrgentPostState.Closed) => true,
        _ => false,
    };
}

public sealed class CreateUrgentPostRequestValidator : AbstractValidator<CreateUrgentPostRequest>
{
    public CreateUrgentPostRequestValidator()
    {
        RuleFor(r => r.Location).NotNull().SetValidator(new CoordinateValidator());
        RuleFor(r => r.Category).Must(UrgentRules.IsCategory).WithMessage("Category must be Injured, Sick, Trapped or Other.");
        RuleFor(r => r.Description).PlainText(UrgentRules.MinDescription, UrgentRules.MaxDescription);
        RuleFor(r => r.PhotoKey).Must(UrgentRules.IsUrgentPhotoKey).WithMessage("Photo key must come from an urgent upload.");
    }
}

public sealed class UpdateUrgentPostRequestValidator : AbstractValidator<UpdateUrgentPostRequest>
{
    public UpdateUrgentPostRequestValidator()
    {
        RuleFor(r => r.State)
            .Must(s => s is nameof(UrgentPostState.Handled) or nameof(UrgentPostState.Closed))
            .WithMessage("State must be Handled or Closed.");
    }
}

public static class UrgentEndpoints
{
    private const string ProblemJson = "application/problem+json";

    public static IServiceCollection AddUrgentServices(this IServiceCollection services)
    {
        services.AddScoped<IUrgentStore, EfUrgentStore>();
        return services;
    }

    public static RouteGroupBuilder MapUrgentEndpoints(this RouteGroupBuilder v1)
    {
        var urgent = v1.MapGroup("/urgent").WithTags("Urgent");

        urgent.MapGet("", ListNearAsync)
            .RequirePermission(Permission.UrgentRead)
            .Produces<UrgentPostListResponse>()
            .ProducesValidationProblem();

        urgent.MapGet("/{id:guid}", GetAsync)
            .RequirePermission(Permission.UrgentRead)
            .Produces<UrgentPostResponse>()
            .Produces<ApiProblemDetails>(StatusCodes.Status404NotFound, ProblemJson);

        urgent.MapPost("", CreateAsync)
            .Validate<CreateUrgentPostRequest>()
            .RequirePermission(Permission.UrgentCreate)
            .Produces<UrgentPostResponse>(StatusCodes.Status201Created)
            .Produces<ApiProblemDetails>(StatusCodes.Status429TooManyRequests, ProblemJson);

        urgent.MapPatch("/{id:guid}", UpdateAsync)
            .Validate<UpdateUrgentPostRequest>()
            .RequirePermission(Permission.UrgentUpdate)
            .Produces<UrgentPostResponse>()
            .Produces<ApiProblemDetails>(StatusCodes.Status403Forbidden, ProblemJson)
            .Produces<ApiProblemDetails>(StatusCodes.Status404NotFound, ProblemJson)
            .Produces<ApiProblemDetails>(StatusCodes.Status409Conflict, ProblemJson);

        v1.MapGet("/me/urgent-posts", MyPostsAsync).RequirePermission(Permission.MeManage);
        return v1;
    }

    /// <summary><c>GET /v1/urgent?near=lat,lng&amp;radius=</c>; open posts only, nearest first.</summary>
    private static async Task<IResult> ListNearAsync(string? near, int? radius, IUrgentStore store, CancellationToken ct, [FromServices] IPhotoUrlResolver? photos = null)
    {
        var query = ParseNear(near, radius ?? UrgentRules.DefaultRadiusMeters);
        var result = query is null ? null : new NearQueryValidator().Validate(query);
        if (query is null || result is { IsValid: false })
        {
            return ValidationFilter<NearQuery>.ValidationProblem(
                new Dictionary<string, string[]> { ["near"] = ["near must be lat,lng and radius 1..5000 metres."] });
        }

        var posts = await store.NearAsync(new GeoPoint(query.Longitude, query.Latitude), query.RadiusMeters, UrgentRules.MaxResults, ct);
        return TypedResults.Ok(new UrgentPostListResponse([.. posts.Select(p => ToResponse(p, photos, PhotoSize.Thumbnail))]));
    }

    private static async Task<IResult> GetAsync(Guid id, IUrgentStore store, CancellationToken ct, [FromServices] IPhotoUrlResolver? photos = null) =>
        await store.FindAsync(id, ct) is { } post ? TypedResults.Ok(ToResponse(post, photos)) : NotFound();

    private static async Task<IResult> CreateAsync(
        HttpContext http, CreateUrgentPostRequest request, IUrgentStore store, IUploadLedger uploads, TimeProvider clock,
        CancellationToken ct, [FromServices] IPhotoUrlResolver? photos = null)
    {
        if (ActorFactory.FromPrincipal(http.User).UserId is not { } userId)
        {
            return TypedResults.Unauthorized();
        }

        if (!await uploads.IsUsableByAsync(userId, request.PhotoKey, ct))
        {
            return ValidationFilter<CreateUrgentPostRequest>.ValidationProblem(
                new Dictionary<string, string[]> { ["photoKey"] = ["Photo was not uploaded by this account."] },
                UrgentErrorCodes.PhotoNotFound);
        }

        var now = clock.GetUtcNow();
        var post = new UrgentPostRecord(
            Guid.CreateVersion7(),
            new GeoPoint(request.Location.Longitude, request.Location.Latitude),
            Enum.Parse<UrgentCategory>(request.Category),
            request.Description.Trim(),
            request.PhotoKey,
            UrgentPostState.Open,
            userId,
            0,
            now);
        if (!await store.TryCreateAsync(post, PatikaDay.StartOf(now), UrgentRules.DailyPostCap, ct))
        {
            return DailyCap.Reached(http, now, "Daily urgent post limit reached.", UrgentErrorCodes.DailyCapReached);
        }

        // The worker job urgent.fanout picks the post up and computes recipients server-side.
        return TypedResults.Created($"/v1/urgent/{post.Id}", ToResponse(post, photos));
    }

    private static async Task<IResult> UpdateAsync(
        HttpContext http, Guid id, UpdateUrgentPostRequest request, IUrgentStore store, IAuthorizationService authorization,
        CancellationToken ct, [FromServices] IPhotoUrlResolver? photos = null)
    {
        if (await store.FindAsync(id, ct) is not { } post)
        {
            return NotFound();
        }

        if (!await authorization.IsAllowedAsync(http.User, new OwnedResource(post.CreatedBy, isPublic: true), Permission.UrgentUpdate))
        {
            return TypedResults.Problem(title: "Forbidden.", statusCode: StatusCodes.Status403Forbidden,
                extensions: new Dictionary<string, object?> { ["code"] = "forbidden" });
        }

        var target = Enum.Parse<UrgentPostState>(request.State);
        if (!UrgentRules.CanMove(post.State, target))
        {
            return TypedResults.Problem(title: "The post cannot move to that state.", statusCode: StatusCodes.Status409Conflict,
                extensions: new Dictionary<string, object?> { ["code"] = UrgentErrorCodes.InvalidTransition });
        }

        await store.UpdateStateAsync(id, target, ct);
        return TypedResults.Ok(ToResponse(post with { State = target }, photos));
    }

    public static async Task<IResult> MyPostsAsync(HttpContext http, PatikaDbContext db, int page = 1, int pageSize = 20, CancellationToken ct = default, [FromServices] IPhotoUrlResolver? photos = null)
    {
        if (ActorFactory.FromPrincipal(http.User).UserId is not { } userId) return TypedResults.Unauthorized();
        if (page is < 1 or > 100000 || pageSize is < 1 or > 100)
            return TypedResults.Problem(statusCode: 400, title: "Invalid paging.");
        var rows = await db.UrgentPosts.AsNoTracking().Where(p => p.CreatedBy == userId)
            .OrderByDescending(p => p.CreatedAt).ThenByDescending(p => p.Id)
            .Skip((page - 1) * pageSize).Take(pageSize + 1).ToListAsync(ct);
        var items = rows.Take(pageSize).Select(p => ToResponse(new UrgentPostRecord(p.Id, p.Location, p.Category,
            p.Description, p.PhotoKey, p.State, p.CreatedBy, p.NotifiedCount, p.CreatedAt), photos, PhotoSize.Thumbnail)).ToArray();
        return TypedResults.Ok(new PageResponse<UrgentPostResponse>(items, page, pageSize, rows.Count > pageSize));
    }

    private static NearQuery? ParseNear(string? near, int radius)
    {
        var parts = near?.Split(',');
        if (parts is not [var lat, var lng]
            || !double.TryParse(lat, NumberStyles.Float, CultureInfo.InvariantCulture, out var latitude)
            || !double.TryParse(lng, NumberStyles.Float, CultureInfo.InvariantCulture, out var longitude))
        {
            return null;
        }

        return new NearQuery(latitude, longitude, radius);
    }

    private static IResult NotFound() => TypedResults.Problem(
        title: "Urgent post not found.", statusCode: StatusCodes.Status404NotFound,
        extensions: new Dictionary<string, object?> { ["code"] = UrgentErrorCodes.NotFound });

    public static UrgentPostResponse ToResponse(UrgentPostRecord post, IPhotoUrlResolver? photos = null, PhotoSize size = PhotoSize.Medium) => new(
        post.Id,
        new CoordinateDto(post.Location.Latitude, post.Location.Longitude),
        post.Category.ToString(),
        post.Description,
        post.PhotoKey,
        post.State.ToString(),
        post.NotifiedCount,
        post.CreatedAt,
        post.DistanceMeters, photos?.Resolve(post.PhotoKey, size));
}
