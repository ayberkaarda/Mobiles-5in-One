using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Patika.Api.Features.Stations;
using Patika.Api.Idempotency;
using Patika.Api.Security.Authorization;
using Patika.Api.Validation;
using Patika.Contracts.Community;
using Patika.Contracts.Geo;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Domain.Security;
using Patika.Infrastructure.Media;
using Patika.Infrastructure.Persistence;

namespace Patika.Api.Features.Animals;

public static class AnimalEndpoints
{
    public static RouteGroupBuilder MapAnimalEndpoints(this RouteGroupBuilder v1)
    {
        var group = v1.MapGroup("/animals").WithTags("Animals");
        group.MapGet("", async ([AsParameters] MapQuery query, PatikaDbContext db, CancellationToken ct) =>
            TypedResults.Ok(await CommunityMap.AnimalsAsync(db, query, ct)))
            .Validate<MapQuery>().RequirePermission(Permission.AnimalsRead);
        group.MapPost("", CreateAsync).Validate<AnimalRequest>().RequirePermission(Permission.AnimalsCreate);
        group.MapGet("/{id:guid}", GetAsync).RequirePermission(Permission.AnimalsRead);
        group.MapPatch("/{id:guid}", UpdateAsync).Validate<AnimalUpdateRequest>().RequirePermission(Permission.AnimalsUpdate);
        group.MapGet("/{id:guid}/photos", PhotosAsync).Validate<PageQuery>().RequirePermission(Permission.AnimalsRead);
        group.MapPost("/{id:guid}/photos", PhotoAsync).Validate<AnimalPhotoRequest>().RequirePermission(Permission.AnimalsCreate);
        group.MapGet("/{id:guid}/sightings", SightingsAsync).Validate<PageQuery>().RequirePermission(Permission.AnimalsRead);
        group.MapPost("/{id:guid}/sightings", SightingAsync).Validate<SightingRequest>().RequirePermission(Permission.AnimalsCreate);
        group.MapPut("/{id:guid}/follow", FollowAsync).RequirePermission(Permission.AnimalFollow);
        group.MapDelete("/{id:guid}/follow", UnfollowAsync).RequirePermission(Permission.AnimalFollow);
        v1.MapGet("/me/follows", MyFollowsAsync).Validate<PageQuery>().RequirePermission(Permission.MeManage);
        return v1;
    }

    public static AnimalResponse Response(Animal x, bool isFollowing = false, int followerCount = 0) => new(x.Id, x.StationId,
        new CoordinateDto(x.Location.Latitude, x.Location.Longitude), x.Species.ToString(), x.Name, x.Sex.ToString(),
        x.Sterilized, x.Vaccinated, x.EarTagged, x.Status.ToString(), x.District, isFollowing, followerCount, x.BirthYear);

    private static async Task<AnimalResponse> ResponseAsync(Animal animal, HttpContext? http, PatikaDbContext db, CancellationToken ct)
    {
        var callerId = http is null ? (Guid?)null : ActorFactory.FromPrincipal(http.User).UserId;
        var follows = db.Follows.Where(f => f.AnimalId == animal.Id);
        return Response(animal, callerId != null && await follows.AnyAsync(f => f.UserId == callerId, ct),
            await follows.CountAsync(ct));
    }

    public static async Task<IResult> MyFollowsAsync([AsParameters] PageQuery query, HttpContext http, PatikaDbContext db, CancellationToken ct)
    {
        if (ActorFactory.FromPrincipal(http.User).UserId is not { } userId) return TypedResults.Unauthorized();
        var rows = await db.Follows.AsNoTracking().Where(f => f.UserId == userId)
            .Join(db.Animals, f => f.AnimalId, a => a.Id, (f, a) => new { Follow = f, Animal = a })
            .OrderByDescending(x => x.Follow.CreatedAt).ThenByDescending(x => x.Follow.Id)
            .Skip((query.Page - 1) * query.PageSize).Take(query.PageSize + 1)
            .Select(x => x.Animal).ToListAsync(ct);
        var ids = rows.Take(query.PageSize).Select(a => a.Id).ToArray();
        var counts = await db.Follows.Where(f => ids.Contains(f.AnimalId)).GroupBy(f => f.AnimalId)
            .Select(g => new { Id = g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Id, g => g.Count, ct);
        var items = rows.Take(query.PageSize).Select(a => Response(a, true, counts.GetValueOrDefault(a.Id))).ToArray();
        return TypedResults.Ok(new PageResponse<AnimalResponse>(items, query.Page, query.PageSize, rows.Count > query.PageSize));
    }

    public static async Task<IResult> CreateAsync(AnimalRequest request, HttpContext http, PatikaDbContext db, CancellationToken ct)
    {
        if (ActorFactory.FromPrincipal(http.User).UserId is not { } userId) return TypedResults.Unauthorized();
        if (request.StationId is { } stationId && !await db.Stations.AnyAsync(x => x.Id == stationId && x.Status != StationStatus.Removed, ct))
            return TypedResults.NotFound();
        var animal = new Animal
        {
            Location = new GeoPoint(request.Location.Longitude, request.Location.Latitude),
            StationId = request.StationId,
            Species = Enum.Parse<Species>(request.Species),
            Sex = Enum.Parse<AnimalSex>(request.Sex),
            Status = Enum.Parse<AnimalStatus>(request.Status),
            Name = request.Name,
            District = request.District?.Trim(),
            BirthYear = request.BirthYear,
            Sterilized = request.Sterilized,
            Vaccinated = request.Vaccinated,
            EarTagged = request.EarTagged,
            CreatedBy = userId
        };
        db.Animals.Add(animal);
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/v1/animals/{animal.Id}", await ResponseAsync(animal, http, db, ct));
    }

    public static async Task<IResult> GetAsync(Guid id, PatikaDbContext db, CancellationToken ct, HttpContext? http = null)
    {
        var animal = await db.Animals.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct);
        return animal is null ? TypedResults.NotFound() : TypedResults.Ok(await ResponseAsync(animal, http, db, ct));
    }

    public static async Task<IResult> UpdateAsync(Guid id, AnimalUpdateRequest request, HttpContext http,
        PatikaDbContext db, IAuthorizationService authorization, CancellationToken ct)
    {
        var animal = await db.Animals.SingleOrDefaultAsync(x => x.Id == id, ct);
        if (animal is null) return TypedResults.NotFound();
        if (!await authorization.IsAllowedAsync(http.User, new OwnedResource(animal.CreatedBy), Permission.AnimalsUpdate))
            return TypedResults.Forbid();
        if (request.StationId is { } stationId)
        {
            if (!await db.Stations.AnyAsync(x => x.Id == stationId && x.Status != StationStatus.Removed, ct)) return TypedResults.NotFound();
            animal.StationId = stationId;
        }
        if (request.Location is { } location) animal.Location = new GeoPoint(location.Longitude, location.Latitude);
        if (request.Species is { } species) animal.Species = Enum.Parse<Species>(species);
        if (request.Sex is { } sex) animal.Sex = Enum.Parse<AnimalSex>(sex);
        if (request.Status is { } status) animal.Status = Enum.Parse<AnimalStatus>(status);
        if (request.Name is { } name) animal.Name = name;
        if (request.District is { } district) animal.District = district.Trim();
        if (request.BirthYear is { } birthYear) animal.BirthYear = birthYear;
        if (request.Sterilized is { } sterilized) animal.Sterilized = sterilized;
        if (request.Vaccinated is { } vaccinated) animal.Vaccinated = vaccinated;
        if (request.EarTagged is { } tagged) animal.EarTagged = tagged;
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(await ResponseAsync(animal, http, db, ct));
    }

    public static async Task<IResult> PhotosAsync(Guid id, [AsParameters] PageQuery query, PatikaDbContext db, CancellationToken ct, [FromServices] IPhotoUrlResolver? photos = null)
    {
        if (!await db.Animals.AnyAsync(x => x.Id == id, ct)) return TypedResults.NotFound();
        var rows = await db.AnimalPhotos.AsNoTracking().Where(x => x.AnimalId == id && x.ModerationState == ModerationState.Approved)
            .OrderByDescending(x => x.CreatedAt).ThenByDescending(x => x.Id).Skip((query.Page - 1) * query.PageSize).Take(query.PageSize + 1)
            .Select(x => new AnimalPhotoResponse(x.Id, x.Key)).ToListAsync(ct);
        return TypedResults.Ok(new PageResponse<AnimalPhotoResponse>(rows.Take(query.PageSize).Select(x => x with { PhotoUrl = photos?.Resolve(x.Key, PhotoSize.Thumbnail) }).ToArray(), query.Page, query.PageSize, rows.Count > query.PageSize));
    }

    public static async Task<IResult> PhotoAsync(Guid id, AnimalPhotoRequest request, HttpContext http, PatikaDbContext db, CancellationToken ct)
    {
        if (ActorFactory.FromPrincipal(http.User).UserId is not { } userId) return TypedResults.Unauthorized();
        if (!await db.Animals.AnyAsync(x => x.Id == id, ct)) return TypedResults.NotFound();
        var photo = new AnimalPhoto { AnimalId = id, Key = request.Key, CreatedBy = userId, ModerationState = ModerationState.Pending };
        db.AnimalPhotos.Add(photo);
        await db.SaveChangesAsync(ct);
        return TypedResults.Accepted(uri: (string?)null, value: new { photo.Id, ModerationState = photo.ModerationState.ToString() });
    }

    public static async Task<IResult> SightingsAsync(Guid id, [AsParameters] PageQuery query, PatikaDbContext db, CancellationToken ct)
    {
        if (!await db.Animals.AnyAsync(x => x.Id == id, ct)) return TypedResults.NotFound();
        var rows = await db.Sightings.AsNoTracking().Where(x => x.AnimalId == id)
            .OrderByDescending(x => x.At).ThenByDescending(x => x.Id).Skip((query.Page - 1) * query.PageSize).Take(query.PageSize + 1)
            .Select(x => new SightingResponse(x.Id, x.At, x.Note)).ToListAsync(ct);
        return TypedResults.Ok(new PageResponse<SightingResponse>(rows.Take(query.PageSize).ToArray(), query.Page, query.PageSize, rows.Count > query.PageSize));
    }

    public static async Task<IResult> SightingAsync(Guid id, SightingRequest request, HttpContext http,
        PatikaDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (ActorFactory.FromPrincipal(http.User).UserId is not { } userId) return TypedResults.Unauthorized();
        if (!await db.Animals.AnyAsync(x => x.Id == id, ct)) return TypedResults.NotFound();
        var sighting = new Sighting { AnimalId = id, UserId = userId, At = ClientTimestamp.Resolve(request.ClientCreatedAt, clock.GetUtcNow()), Note = request.Note };
        db.Sightings.Add(sighting);
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/v1/animals/{id}/sightings/{sighting.Id}", new SightingResponse(sighting.Id, sighting.At, sighting.Note));
    }

    public static Task<IResult> FollowAsync(Guid id, HttpContext http, PatikaDbContext db, IAuthorizationService authorization, CancellationToken ct) =>
        SetFollowAsync(id, true, http, db, authorization, ct);

    public static Task<IResult> UnfollowAsync(Guid id, HttpContext http, PatikaDbContext db, IAuthorizationService authorization, CancellationToken ct) =>
        SetFollowAsync(id, false, http, db, authorization, ct);

    private static async Task<IResult> SetFollowAsync(Guid id, bool follow, HttpContext http,
        PatikaDbContext db, IAuthorizationService authorization, CancellationToken ct)
    {
        if (ActorFactory.FromPrincipal(http.User).UserId is not { } userId) return TypedResults.Unauthorized();
        if (!await authorization.IsAllowedAsync(http.User, new OwnedResource(userId), Permission.AnimalFollow)) return TypedResults.Forbid();
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var animal = await db.Animals.FromSqlInterpolated($"SELECT * FROM animals WHERE id = {id} FOR UPDATE").SingleOrDefaultAsync(ct);
        if (animal is null) return TypedResults.NotFound();
        var existing = await db.Follows.SingleOrDefaultAsync(x => x.AnimalId == id && x.UserId == userId, ct);
        if (follow && existing is null) db.Follows.Add(new Follow { AnimalId = id, UserId = userId });
        if (!follow && existing is not null) db.Follows.Remove(existing);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return TypedResults.NoContent();
    }
}
