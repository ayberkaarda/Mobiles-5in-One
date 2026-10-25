using Microsoft.EntityFrameworkCore;
using Patika.Contracts.Community;
using Patika.Infrastructure.Persistence;

namespace Patika.Api.Features.Stations;

public static class CommunityMap
{
    public static async Task<PageResponse<MapFeature>> StationsAsync(PatikaDbContext db, MapQuery query, CancellationToken ct)
    {
        var box = CommunityValidation.ParseBox(query.Bbox)!;
        var cell = 360d / (256 * Math.Pow(2, query.Zoom)) * 64;
        var offset = (query.Page - 1) * query.PageSize;
        await using var mapDb = new CommunityMapContext(db);
        var rows = await mapDb.Set<MapRow>().FromSqlInterpolated($"""
            SELECT CASE WHEN count(*) = 1 THEN min(id::text)::uuid ELSE NULL END AS "Id",
                avg(lat) AS "Latitude", avg(lng) AS "Longitude", count(*)::int AS "Count"
            FROM (
                SELECT id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, ST_SnapToGrid(location::geometry, {cell}) AS grid FROM stations
                WHERE status <> 'Removed'
                AND ST_Intersects(location::geometry, ST_MakeEnvelope({box.MinLongitude}, {box.MinLatitude}, {box.MaxLongitude}, {box.MaxLatitude}, 4326))
                AND ({query.Kind}::text IS NULL OR kind = {query.Kind})
                AND ({query.Species}::text IS NULL OR species = {query.Species})
                AND ({query.NeedsRefill}::boolean IS NULL OR (status = 'NeedsRefill') = {query.NeedsRefill})
            ) AS visible GROUP BY grid ORDER BY ST_X(grid), ST_Y(grid)
            OFFSET {offset} LIMIT {query.PageSize + 1}
            """).ToListAsync(ct);
        return Page(rows, query);
    }

    public static async Task<PageResponse<MapFeature>> AnimalsAsync(PatikaDbContext db, MapQuery query, CancellationToken ct)
    {
        var box = CommunityValidation.ParseBox(query.Bbox)!;
        var cell = 360d / (256 * Math.Pow(2, query.Zoom)) * 64;
        var offset = (query.Page - 1) * query.PageSize;
        await using var mapDb = new CommunityMapContext(db);
        var rows = await mapDb.Set<MapRow>().FromSqlInterpolated($"""
            SELECT CASE WHEN count(*) = 1 THEN min(id::text)::uuid ELSE NULL END AS "Id",
                avg(lat) AS "Latitude", avg(lng) AS "Longitude", count(*)::int AS "Count"
            FROM (
                SELECT id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, ST_SnapToGrid(location::geometry, {cell}) AS grid FROM animals
                WHERE ST_Intersects(location::geometry, ST_MakeEnvelope({box.MinLongitude}, {box.MinLatitude}, {box.MaxLongitude}, {box.MaxLatitude}, 4326))
                AND ({query.Species}::text IS NULL OR species = {query.Species})
            ) AS visible GROUP BY grid ORDER BY ST_X(grid), ST_Y(grid)
            OFFSET {offset} LIMIT {query.PageSize + 1}
            """).ToListAsync(ct);
        return Page(rows, query);
    }

    private static PageResponse<MapFeature> Page(List<MapRow> rows, MapQuery query) => new(
        rows.Take(query.PageSize).Select(x => new MapFeature(x.Id, x.Latitude, x.Longitude, x.Count)).ToArray(),
        query.Page, query.PageSize, rows.Count > query.PageSize);
}
public sealed class MapRow
{
    public Guid? Id { get; set; }
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public int Count { get; set; }
}

internal sealed class CommunityMapContext(PatikaDbContext source) : DbContext(
    new DbContextOptionsBuilder<CommunityMapContext>().UseNpgsql(source.Database.GetDbConnection()).Options)
{
    protected override void OnModelCreating(ModelBuilder modelBuilder) => modelBuilder.Entity<MapRow>().HasNoKey();
}
