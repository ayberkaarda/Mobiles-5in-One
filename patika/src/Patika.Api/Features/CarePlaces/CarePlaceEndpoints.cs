using System.Globalization;
using Microsoft.EntityFrameworkCore;

using Patika.Api.Security.Authorization;
using Patika.Api.Validation;
using Patika.Contracts.CarePlaces;
using Patika.Domain.Entities;
using Patika.Domain.Security;
using Patika.Infrastructure.Persistence;

namespace Patika.Api.Features.CarePlaces;

public static class CarePlaceEndpoints
{
    public static RouteGroupBuilder MapCarePlaceEndpoints(this RouteGroupBuilder v1)
    {
        v1.MapGet("/care-places", List).RequirePermission(Permission.CarePlacesRead).Produces<CarePlaceResponse[]>();
        return v1;
    }

    private static async Task<IResult> List(PatikaDbContext db, string? near, CarePlaceKind? kind, bool? open24h,
        int radius = 5000, int page = 1, int pageSize = 20, CancellationToken ct = default)
    {
        if (page is < 1 or > 100000 || pageSize is < 1 or > 100 || radius is < 1 or > 5000
            || (kind.HasValue && !Enum.IsDefined(kind.Value))) return Invalid();
        var query = db.CarePlaces.AsNoTracking();
        if (kind.HasValue) query = query.Where(p => p.Kind == kind);
        if (open24h.HasValue) query = query.Where(p => p.Open24h == open24h);
        IOrderedQueryable<CarePlace> ordered;
        if (near is not null)
        {
            var parts = near.Split(',');
            if (parts.Length != 2 || !double.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var lat)
                || !double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var lon)
                || !GeoRules.IsValidCoordinate(lat, lon)) return Invalid();
            var nearby = await Nearby(db, lat, lon, radius, kind, open24h, page, pageSize).ToListAsync(ct);
            return Results.Ok(nearby.Select(View));
        }
        else ordered = query.OrderBy(p => p.Name).ThenBy(p => p.Id);
        var rows = await ordered.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        return Results.Ok(rows.Select(View));
    }

    private static CarePlaceResponse View(CarePlace p) => new(p.Id, p.Name, p.Kind.ToString(),
        p.Location.Latitude, p.Location.Longitude, p.Address, p.Phone, p.HoursJson, p.Open24h, p.Verified, p.IsSample);

    internal static IQueryable<CarePlace> Nearby(PatikaDbContext db, double latitude, double longitude,
        int radius, CarePlaceKind? kind, bool? open24h, int page, int pageSize)
    {
        var kindName = kind?.ToString();
        var offset = (page - 1) * pageSize;
        return db.CarePlaces.FromSql($"""
            SELECT * FROM care_places
            WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint({longitude}, {latitude}), 4326)::geography, {radius})
                AND ({kindName}::text IS NULL OR kind = {kindName})
                AND ({open24h}::boolean IS NULL OR open24h = {open24h})
            ORDER BY ST_Distance(location, ST_SetSRID(ST_MakePoint({longitude}, {latitude}), 4326)::geography), id
            LIMIT {pageSize} OFFSET {offset}
            """).AsNoTracking();
    }

    private static IResult Invalid() => Results.Problem(statusCode: 400, title: "İstek geçersiz.");
}
