using FluentValidation;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Patika.Api.Security.Authorization;
using Patika.Api.Validation;
using Patika.Contracts.Errors;
using Patika.Contracts.Media;
using Patika.Domain.Security;
using Patika.Infrastructure.Billing;
using Patika.Infrastructure.Media;

namespace Patika.Api.Features.Media;

public sealed class PresignUploadRequestValidator : AbstractValidator<PresignUploadRequest>
{
    public PresignUploadRequestValidator()
    {
        RuleFor(r => r.Kind)
            .Must(MediaKeys.IsKind).WithMessage("Kind must be station, animal, feeding or urgent.");
        // Exact, lower-case, parameter-free: image/svg+xml, text/html, "image/jpeg; charset=x" and
        // "IMAGE/JPEG" are all rejected, so the signed header can only ever name a raster type.
        RuleFor(r => r.ContentType)
            .Must(MediaKeys.IsContentType).WithMessage("Content type must be image/jpeg, image/png or image/webp.");
        RuleFor(r => r.ContentLength)
            .InclusiveBetween(1, MediaKeys.MaxUploadBytes).WithMessage("Content length must be between 1 byte and 5 MB.");
    }
}

public static class MediaEndpoints
{
    private const string ProblemJson = "application/problem+json";

    public static IServiceCollection AddMediaServices(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<StorageSettings>().Bind(configuration.GetSection(StorageSettings.SectionName));
        services.AddOptions<MediaSettings>().Bind(configuration.GetSection(MediaSettings.SectionName));
        services.AddSingleton<IUploadPresigner, S3UploadPresigner>();
        services.AddSingleton<IPhotoUrlResolver, PhotoUrlResolver>();
        services.AddScoped<IUploadLedger, PgUploadLedger>();
        services.AddScoped<ISupporterEntitlement, EfSupporterEntitlement>();
        // Hosts without billing configured count no test purchases; AddPlayBilling replaces this with the real policy.
        services.TryAddSingleton(new BillingOptions());
        return services;
    }

    public static RouteGroupBuilder MapMediaEndpoints(this RouteGroupBuilder v1)
    {
        var uploads = v1.MapGroup("/uploads").WithTags("Uploads");

        uploads.MapPost("/presign", PresignAsync)
            .Validate<PresignUploadRequest>()
            .RequirePermission(Permission.UploadsPresign)
            .Produces<PresignUploadResponse>()
            .Produces<ApiProblemDetails>(StatusCodes.Status401Unauthorized, ProblemJson)
            .Produces<ApiProblemDetails>(StatusCodes.Status429TooManyRequests, ProblemJson);

        return v1;
    }

    private static async Task<IResult> PresignAsync(
        HttpContext http, PresignUploadRequest request, IUploadLedger ledger, ISupporterEntitlement supporter,
        IUploadPresigner presigner, IOptions<MediaSettings> options, TimeProvider clock, CancellationToken ct)
    {
        if (ActorFactory.FromPrincipal(http.User).UserId is not { } userId)
        {
            return TypedResults.Unauthorized();
        }

        var settings = options.Value;
        var now = clock.GetUtcNow();
        var limit = await supporter.IsSupporterAsync(userId, now, ct) ? settings.SupporterDailyQuota : settings.DailyQuota;
        var uploadId = Guid.CreateVersion7();
        var photoKey = MediaKeys.PhotoKey(request.Kind, uploadId);
        var remaining = await ledger.TryReserveAsync(
            new UploadReservation(uploadId, userId, request.Kind, photoKey, request.ContentType, request.ContentLength, now),
            PatikaDay.StartOf(now), limit, ct);
        if (remaining is null)
        {
            return DailyCap.Reached(http, now, "Daily upload quota reached.", MediaErrorCodes.QuotaExceeded);
        }

        var expiresAt = now.AddMinutes(settings.PresignMinutes);
        var url = await presigner.PresignPutAsync(MediaKeys.Incoming(photoKey), request.ContentType, request.ContentLength, expiresAt);
        var headers = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["Content-Type"] = request.ContentType,
            ["Content-Length"] = request.ContentLength.ToString(System.Globalization.CultureInfo.InvariantCulture),
        };
        return TypedResults.Ok(new PresignUploadResponse(uploadId, photoKey, "PUT", url.AbsoluteUri, headers, expiresAt, remaining.Value));
    }
}
