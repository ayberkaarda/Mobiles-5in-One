using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Patika.Api.Security.Authorization;
using Patika.Api.Validation;
using Patika.Contracts.Community;
using Patika.Contracts.Geo;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Domain.Security;
using Patika.Infrastructure.Persistence;

namespace Patika.Api.Features.Stations;

public static class StationEndpoints
{
    public static RouteGroupBuilder MapStationEndpoints(this RouteGroupBuilder v1)
    {
        var group = v1.MapGroup("/stations").WithTags("Stations");
        group.MapGet("", async ([AsParameters] MapQuery query, PatikaDbContext db, CancellationToken ct) =>
            TypedResults.Ok(await CommunityMap.StationsAsync(db, query, ct)))
            .Validate<MapQuery>().RequirePermission(Permission.StationsRead);
        group.MapPost("", CreateAsync).Validate<StationRequest>().RequirePermission(Permission.StationsCreate);
        group.MapGet("/{id:guid}", GetAsync).RequirePermission(Permission.StationsRead);
        group.MapPatch("/{id:guid}", UpdateAsync).Validate<StationUpdateRequest>().RequirePermission(Permission.StationsUpdate);
        group.MapGet("/{id:guid}/feedings", FeedingsAsync).Validate<PageQuery>().RequirePermission(Permission.StationsRead);
        group.MapPost("/{id:guid}/feedings", FeedAsync).Validate<FeedingRequest>().RequirePermission(Permission.FeedingsCreate);
        group.MapPost("/{id:guid}/needs-refill", RefillAsync).RequirePermission(Permission.FeedingsCreate);
        return v1;
    }

    public static StationResponse Response(Station x) => new(x.Id, x.Name,
        new CoordinateDto(x.Location.Latitude, x.Location.Longitude), x.Kind.ToString(), x.Species.ToString(),
        x.PhotoKey, x.Status.ToString(), x.LastFedAt, x.FeedingsCount);

    public static async Task<IResult> CreateAsync(StationRequest request, HttpContext http, PatikaDbContext db, CancellationToken ct)
    {
        var actor = ActorFactory.FromPrincipal(http.User);
        if (actor.UserId is not { } userId) return TypedResults.Unauthorized();
        var station = new Station
        {
            Location = new GeoPoint(request.Location.Longitude, request.Location.Latitude),
            Kind = Enum.Parse<StationKind>(request.Kind),
            Species = Enum.Parse<Species>(request.Species),
            PhotoKey = request.PhotoKey,
            Name = request.Name,
            CreatedBy = userId,
            Status = StationStatus.Active
        };
        db.Stations.Add(station);
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/v1/stations/{station.Id}", Response(station));
    }

    public static async Task<IResult> GetAsync(Guid id, PatikaDbContext db, CancellationToken ct)
    {
        var station = await db.Stations.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id && x.Status != StationStatus.Removed, ct);
        if (station is null) return TypedResults.NotFound();
        var feedings = await db.Feedings.AsNoTracking().Where(x => x.StationId == id)
            .OrderByDescending(x => x.At).ThenByDescending(x => x.Id).Take(10)
            .Select(x => new FeedingResponse(x.Id, x.At, x.PhotoKey, x.Note)).ToListAsync(ct);
        return TypedResults.Ok(new { Station = Response(station), Feedings = feedings });
    }

    public static async Task<IResult> UpdateAsync(Guid id, StationUpdateRequest request, HttpContext http,
        PatikaDbContext db, IAuthorizationService authorization, CancellationToken ct)
    {
        var station = await db.Stations.SingleOrDefaultAsync(x => x.Id == id && x.Status != StationStatus.Removed, ct);
        if (station is null) return TypedResults.NotFound();
        if (!await authorization.IsAllowedAsync(http.User, new OwnedResource(station.CreatedBy), Permission.StationsUpdate))
            return TypedResults.Forbid();
        if (request.Location is { } location) station.Location = new GeoPoint(location.Longitude, location.Latitude);
        if (request.Kind is { } kind) station.Kind = Enum.Parse<StationKind>(kind);
        if (request.Species is { } species) station.Species = Enum.Parse<Species>(species);
        if (request.PhotoKey is { } photo) station.PhotoKey = photo;
        if (request.Name is { } name) station.Name = name;
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(Response(station));
    }

    public static async Task<IResult> FeedingsAsync(Guid id, [AsParameters] PageQuery query, PatikaDbContext db, CancellationToken ct)
    {
        if (!await db.Stations.AnyAsync(x => x.Id == id && x.Status != StationStatus.Removed, ct)) return TypedResults.NotFound();
        var rows = await db.Feedings.AsNoTracking().Where(x => x.StationId == id)
            .OrderByDescending(x => x.At).ThenByDescending(x => x.Id).Skip((query.Page - 1) * query.PageSize).Take(query.PageSize + 1)
            .Select(x => new FeedingResponse(x.Id, x.At, x.PhotoKey, x.Note)).ToListAsync(ct);
        return TypedResults.Ok(new PageResponse<FeedingResponse>(rows.Take(query.PageSize).ToArray(), query.Page, query.PageSize, rows.Count > query.PageSize));
    }

    public static async Task<IResult> FeedAsync(Guid id, FeedingRequest request, HttpContext http,
        PatikaDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (ActorFactory.FromPrincipal(http.User).UserId is not { } userId) return TypedResults.Unauthorized();
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var station = await db.Stations.FromSqlInterpolated($"SELECT * FROM stations WHERE id = {id} FOR UPDATE").SingleOrDefaultAsync(ct);
        if (station is null || station.Status == StationStatus.Removed) return TypedResults.NotFound();
        var now = clock.GetUtcNow();
        if (await db.Feedings.AnyAsync(x => x.StationId == id && x.UserId == userId && x.At > now.AddMinutes(-30), ct))
            return TypedResults.Problem(statusCode: 409, title: "Bu istasyonda yeniden besleme için 30 dakika bekleyin.",
                extensions: new Dictionary<string, object?> { ["code"] = "feeding_cooldown" });
        var feeding = new Feeding { StationId = id, UserId = userId, At = now, PhotoKey = request.PhotoKey, Note = request.Note };
        db.Feedings.Add(feeding);
        station.LastFedAt = now;
        station.FeedingsCount++;
        station.Status = StationStatus.Active;
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return TypedResults.Created($"/v1/stations/{id}/feedings/{feeding.Id}", new FeedingResponse(feeding.Id, feeding.At, feeding.PhotoKey, feeding.Note));
    }

    public static async Task<IResult> RefillAsync(Guid id, PatikaDbContext db, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var station = await db.Stations.FromSqlInterpolated($"SELECT * FROM stations WHERE id = {id} FOR UPDATE").SingleOrDefaultAsync(ct);
        if (station is null || station.Status == StationStatus.Removed) return TypedResults.NotFound();
        station.Status = StationStatus.NeedsRefill;
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return TypedResults.NoContent();
    }
}
