using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Patika.Api.Security.Authorization;
using Patika.Api.Validation;
using Patika.Contracts.Adoptions;
using Patika.Contracts.Community;
using Patika.Domain.Entities;
using Patika.Domain.Security;
using Patika.Infrastructure.Media;
using Patika.Infrastructure.Persistence;

namespace Patika.Api.Features.Adoptions;

public static class AdoptionEndpoints
{
    public static RouteGroupBuilder MapAdoptionEndpoints(this RouteGroupBuilder v1)
    {
        v1.MapGet("/adoptions", List).RequirePermission(Permission.AdoptionsRead).Produces<AdoptionPostResponse[]>();
        v1.MapGet("/adoptions/{id:guid}", Get).RequirePermission(Permission.AdoptionsRead).Produces<AdoptionPostResponse>();
        v1.MapPost("/animals/{id:guid}/adoption", Create).Validate<CreateAdoptionPost>()
            .RequirePermission(Permission.AdoptionPostCreate).Produces<AdoptionPostResponse>(201);
        v1.MapPatch("/adoptions/{id:guid}", Update).Validate<UpdateAdoptionPost>()
            .RequirePermission(Permission.AdoptionPostUpdate).Produces<AdoptionPostResponse>();
        v1.MapPost("/adoptions/{id:guid}/requests", Request).Validate<CreateAdoptionRequest>()
            .RequirePermission(Permission.AdoptionRequestCreate).Produces<AdoptionRequestResponse>(201);
        v1.MapGet("/adoptions/{id:guid}/requests", Requests)
            .RequirePermission(Permission.AdoptionRequestsRead).Produces<AdoptionRequestResponse[]>();
        v1.MapGet("/adoptions/{id:guid}/requests/{rid:guid}", GetRequest)
            .RequirePermission(Permission.AdoptionRequestsRead).Produces<AdoptionRequestResponse>();
        v1.MapPatch("/adoptions/{id:guid}/requests/{rid:guid}", Reply).Validate<ReplyToAdoptionRequest>()
            .RequirePermission(Permission.AdoptionRequestUpdate).Produces<AdoptionRequestResponse>();
        v1.MapGet("/me/adoption-requests", MyRequests).RequirePermission(Permission.MeManage);
        return v1;
    }

    public static bool CanManage(Actor actor, AdoptionPost post) => Permissions.IsAllowed(actor,
        Permission.AdoptionPostUpdate, new OwnedResource(post.CreatedBy));

    public static bool CanReadRequest(Actor actor, AdoptionPost post, AdoptionRequest request) =>
        request.PostId == post.Id && Permissions.IsAllowed(actor, Permission.AdoptionRequestsRead,
            new OwnedResource([post.CreatedBy, request.RequesterId]));

    private static bool Public(AdoptionPost post) => post.State == AdoptionPostState.Published && post.ClosesAt > DateTimeOffset.UtcNow;
    private static AdoptionPostResponse View(AdoptionPost p) => new(p.Id, p.AnimalId, p.Description, p.Requirements, p.District, p.State.ToString(), p.ClosesAt);
    private static AdoptionRequestResponse View(AdoptionRequest r) => new(r.Id, r.PostId, r.Message, r.Reply, r.State.ToString());
    private static async Task<AdoptionPostResponse[]> EnrichAsync(IReadOnlyList<AdoptionPost> posts, PatikaDbContext db, CancellationToken ct, IPhotoUrlResolver? photos, PhotoSize size = PhotoSize.Medium)
    {
        var ids = posts.Select(p => p.AnimalId).ToArray();
        var animals = await db.Animals.AsNoTracking().Where(a => ids.Contains(a.Id)).ToDictionaryAsync(a => a.Id, ct);
        var keys = await db.Animals.AsNoTracking().Where(a => ids.Contains(a.Id))
            .Select(a => new
            {
                a.Id,
                Key = db.AnimalPhotos.Where(p => p.AnimalId == a.Id && p.ModerationState == ModerationState.Approved)
                .OrderBy(p => p.CreatedAt).ThenBy(p => p.Id).Select(p => p.Key).FirstOrDefault()
            })
            .ToDictionaryAsync(a => a.Id, a => a.Key, ct);
        return posts.Select(p =>
        {
            var a = animals[p.AnimalId];
            return View(p) with
            {
                AnimalName = a.Name,
                Species = a.Species.ToString(),
                Status = a.Status.ToString(),
                Sterilized = a.Sterilized,
                Vaccinated = a.Vaccinated,
                EarTagged = a.EarTagged,
                FirstPhotoKey = keys.GetValueOrDefault(a.Id),
                FirstPhotoUrl = photos?.Resolve(keys.GetValueOrDefault(a.Id), size)
            };
        }).ToArray();
    }

    public static async Task<IResult> MyRequests(HttpContext http, PatikaDbContext db, int page = 1, int pageSize = 20, CancellationToken ct = default)
    {
        if (ActorFactory.FromPrincipal(http.User).UserId is not { } userId) return Results.Unauthorized();
        if (page is < 1 or > 100000 || pageSize is < 1 or > 100) return Invalid();
        var rows = await db.AdoptionRequests.AsNoTracking().Where(r => r.RequesterId == userId)
            .OrderByDescending(r => r.CreatedAt).ThenByDescending(r => r.Id)
            .Skip((page - 1) * pageSize).Take(pageSize + 1).ToListAsync(ct);
        return Results.Ok(new PageResponse<AdoptionRequestResponse>(rows.Take(pageSize).Select(View).ToArray(), page, pageSize, rows.Count > pageSize));
    }

    private static IResult Invalid() => Results.Problem(statusCode: 400, title: "İstek geçersiz.");

    /// <summary>Concurrent creates kept taking the same public address; the client may simply retry.</summary>
    internal static IResult SlugConflict() => Results.Problem(statusCode: 409, title: "Aynı anda çok fazla benzer kayıt oluşturuldu; lütfen tekrar deneyin.",
        extensions: new Dictionary<string, object?> { ["code"] = "slug_conflict" });

    internal static async Task<IResult> List(PatikaDbContext db, string? district, Species? species, int page = 1, int pageSize = 20, CancellationToken ct = default, [FromServices] IPhotoUrlResolver? photos = null)
    {
        if (page is < 1 or > 100000 || pageSize is < 1 or > 100 || (species.HasValue && !Enum.IsDefined(species.Value))) return Invalid();
        var now = DateTimeOffset.UtcNow;
        var query = db.AdoptionPosts.AsNoTracking().Where(p => p.State == AdoptionPostState.Published && p.ClosesAt > now
            && db.Animals.Any(a => a.Id == p.AnimalId && a.Status != AnimalStatus.Adopted));
        if (district is not null) query = query.Where(p => p.District == district);
        if (species is not null) query = query.Where(p => db.Animals.Any(a => a.Id == p.AnimalId && a.Species == species));
        var rows = await query.OrderByDescending(p => p.CreatedAt).ThenBy(p => p.Id).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        return Results.Ok(await EnrichAsync(rows, db, ct, photos, PhotoSize.Thumbnail));
    }

    internal static async Task<IResult> Get(Guid id, HttpContext http, PatikaDbContext db, CancellationToken ct, [FromServices] IPhotoUrlResolver? photos = null)
    {
        var post = await db.AdoptionPosts.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, ct);
        if (post is null) return Results.NotFound();
        var visible = Public(post) && !await db.Animals.AnyAsync(a => a.Id == post.AnimalId && a.Status == AnimalStatus.Adopted, ct);
        if (!visible && !CanManage(ActorFactory.FromPrincipal(http.User), post)) return Results.NotFound();
        return Results.Ok((await EnrichAsync([post], db, ct, photos))[0]);
    }

    internal static async Task<IResult> Create(Guid id, CreateAdoptionPost body, HttpContext http, PatikaDbContext db, CancellationToken ct, [FromServices] IPhotoUrlResolver? photos = null)
    {
        var actor = ActorFactory.FromPrincipal(http.User);
        var animal = await db.Animals.SingleOrDefaultAsync(a => a.Id == id, ct);
        if (animal is null) return Results.NotFound();
        if (!Permissions.IsAllowed(actor, Permission.AdoptionPostCreate, new OwnedResource(animal.CreatedBy))) return Results.Forbid();
        if (animal.Status == AnimalStatus.Adopted || await db.AdoptionPosts.AnyAsync(p => p.AnimalId == id && (p.State == AdoptionPostState.Pending || p.State == AdoptionPostState.Published), ct))
            return Results.Conflict();
        var post = new AdoptionPost
        {
            AnimalId = id,
            CreatedBy = actor.UserId!.Value,
            Description = AdoptionText.Clean(body.Description),
            Requirements = AdoptionText.Clean(body.Requirements),
            District = AdoptionText.Clean(body.District),
            State = AdoptionPostState.Pending,
            ClosesAt = DateTimeOffset.UtcNow.AddDays(60)
        };
        post.DistrictId = await new DistrictResolver(db).ResolveAsync(post.District, ct);
        db.AdoptionPosts.Add(post);
        try
        {
            await db.SaveChangesWithSlugRetryAsync(ct);
        }
        catch (SlugConflictException)
        {
            return SlugConflict();
        }
        return Results.Created($"/v1/adoptions/{post.Id}", (await EnrichAsync([post], db, ct, photos))[0]);
    }

    internal static async Task<IResult> Update(Guid id, UpdateAdoptionPost body, HttpContext http, PatikaDbContext db, CancellationToken ct, [FromServices] IPhotoUrlResolver? photos = null)
    {
        var post = await db.AdoptionPosts.SingleOrDefaultAsync(p => p.Id == id, ct);
        if (post is null) return Results.NotFound();
        var actor = ActorFactory.FromPrincipal(http.User);
        if (!CanManage(actor, post)) return Results.Forbid();
        if (body.State is "Published" or "Rejected" && !actor.IsModeratorOrAbove) return Results.Forbid();
        if (post.State == AdoptionPostState.Closed) return Results.Conflict();
        var edited = body.Description is not null || body.Requirements is not null || body.District is not null;
        if (body.Description is not null) post.Description = AdoptionText.Clean(body.Description);
        if (body.Requirements is not null) post.Requirements = AdoptionText.Clean(body.Requirements);
        if (body.District is not null) post.District = AdoptionText.Clean(body.District);
        if (edited) post.State = AdoptionPostState.Pending;
        if (body.State == "Published" && (post.ClosesAt <= DateTimeOffset.UtcNow
            || await db.Animals.AnyAsync(a => a.Id == post.AnimalId && a.Status == AnimalStatus.Adopted, ct))) return Results.Conflict();
        if (body.State is not null) post.State = Enum.Parse<AdoptionPostState>(body.State);
        if (post.State == AdoptionPostState.Closed)
        {
            // Old clients send no reason; a manual close then means the owner withdrew the post.
            var reason = body.Reason == "Adopted" ? AdoptionClosedReason.Adopted : AdoptionClosedReason.Withdrawn;
            await AdoptionClosureService.ClosePostAsync(db, post, ct, reason);
        }
        if (actor.IsModeratorOrAbove) db.AuditLogs.Add(new AuditLog { ActorId = actor.UserId, Action = "adoption.update", TargetType = "adoption", TargetId = id });
        await db.SaveChangesAsync(ct);
        return Results.Ok((await EnrichAsync([post], db, ct, photos))[0]);
    }

    internal static async Task<IResult> Request(Guid id, CreateAdoptionRequest body, HttpContext http, PatikaDbContext db, CancellationToken ct)
    {
        var post = await db.AdoptionPosts.SingleOrDefaultAsync(p => p.Id == id, ct);
        if (post is null || !Public(post)) return Results.NotFound();
        var actor = ActorFactory.FromPrincipal(http.User);
        if (post.CreatedBy == actor.UserId || await db.Animals.AnyAsync(a => a.Id == post.AnimalId && a.Status == AnimalStatus.Adopted, ct)) return Results.Conflict();
        if (await db.AdoptionRequests.AnyAsync(r => r.PostId == id && r.RequesterId == actor.UserId, ct)) return Results.Conflict();
        var request = new AdoptionRequest { PostId = id, RequesterId = actor.UserId!.Value, Message = AdoptionText.Clean(body.Message), State = AdoptionRequestState.Pending };
        db.AdoptionRequests.Add(request);
        await db.SaveChangesAsync(ct);
        return Results.Created($"/v1/adoptions/{id}/requests/{request.Id}", View(request));
    }

    internal static async Task<IResult> Requests(Guid id, HttpContext http, PatikaDbContext db, int page = 1, int pageSize = 20, CancellationToken ct = default)
    {
        if (page is < 1 or > 100000 || pageSize is < 1 or > 100) return Invalid();
        var post = await db.AdoptionPosts.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, ct);
        if (post is null) return Results.NotFound();
        if (!CanManage(ActorFactory.FromPrincipal(http.User), post)) return Results.Forbid();
        var rows = await db.AdoptionRequests.AsNoTracking().Where(r => r.PostId == id).OrderByDescending(r => r.CreatedAt).ThenBy(r => r.Id)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        return Results.Ok(rows.Select(View));
    }

    internal static async Task<IResult> GetRequest(Guid id, Guid rid, HttpContext http, PatikaDbContext db, CancellationToken ct)
    {
        var post = await db.AdoptionPosts.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, ct);
        var request = await db.AdoptionRequests.AsNoTracking().SingleOrDefaultAsync(r => r.Id == rid && r.PostId == id, ct);
        if (post is null || request is null) return Results.NotFound();
        return CanReadRequest(ActorFactory.FromPrincipal(http.User), post, request) ? Results.Ok(View(request)) : Results.Forbid();
    }

    internal static async Task<IResult> Reply(Guid id, Guid rid, ReplyToAdoptionRequest body, HttpContext http, PatikaDbContext db, CancellationToken ct)
    {
        var post = await db.AdoptionPosts.SingleOrDefaultAsync(p => p.Id == id, ct);
        var request = await db.AdoptionRequests.SingleOrDefaultAsync(r => r.Id == rid && r.PostId == id, ct);
        if (post is null || request is null) return Results.NotFound();
        if (!CanManage(ActorFactory.FromPrincipal(http.User), post)) return Results.Forbid();
        if (!Public(post) || request.State == AdoptionRequestState.Closed
            || await db.Animals.AnyAsync(a => a.Id == post.AnimalId && a.Status == AnimalStatus.Adopted, ct)) return Results.Conflict();
        request.Reply = AdoptionText.Clean(body.Reply);
        request.State = AdoptionRequestState.Replied;
        await db.SaveChangesAsync(ct);
        return Results.Ok(View(request));
    }
}
