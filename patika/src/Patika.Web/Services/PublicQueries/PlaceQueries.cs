using Microsoft.EntityFrameworkCore;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;

namespace Patika.Web.Services.PublicQueries;

public sealed class PlaceQueries(PatikaDbContext db, IAdoptionQueries adoptions, ICarePlaceQueries carePlaces,
    TimeProvider clock) : IPlaceQueries
{
    public async Task<IReadOnlyList<ProvinceSummary>> ListProvincesAsync(CancellationToken ct = default) =>
        await db.Provinces.OrderBy(p => p.Name).Select(p => new ProvinceSummary(p.Name, p.Slug)).ToListAsync(ct);

    public async Task<ProvinceDetail?> GetProvinceAsync(string provinceSlug, CancellationToken ct = default)
    {
        var province = await db.Provinces.Where(p => p.Slug == provinceSlug).Select(p => new { p.Id, p.Name, p.Slug }).SingleOrDefaultAsync(ct);
        if (province is null) return null;
        var now = clock.GetUtcNow();
        var rows = await db.Districts.Where(d => d.ProvinceId == province.Id).Select(d => new DistrictListItem(d.Name, d.Slug,
            db.Stations.Count(s => s.DistrictId == d.Id && s.Status != StationStatus.Removed),
            db.AdoptionPosts.Count(p => p.DistrictId == d.Id && p.State == AdoptionPostState.Published && p.ClosesAt > now
                && db.Animals.Any(a => a.Id == p.AnimalId && a.Status != AnimalStatus.Adopted)))).ToListAsync(ct);
        var turkish = StringComparer.Create(System.Globalization.CultureInfo.GetCultureInfo("tr-TR"), ignoreCase: true);
        return new ProvinceDetail(province.Name, province.Slug, rows
            .OrderByDescending(d => d.ActiveStations + d.OpenAdoptions > 0).ThenBy(d => d.Name, turkish).ToArray());
    }

    public async Task<DistrictSummary?> GetDistrictAsync(string provinceSlug, string districtSlug, CancellationToken ct = default)
    {
        var district = await (from d in db.Districts
                              join p in db.Provinces on d.ProvinceId equals p.Id
                              where d.Slug == districtSlug && p.Slug == provinceSlug
                              select new { d.Id, d.Name, d.Slug, ProvinceName = p.Name, ProvinceSlug = p.Slug }).SingleOrDefaultAsync(ct);
        if (district is null) return null;
        var now = clock.GetUtcNow();
        var local = TimeZoneInfo.ConvertTime(now, TimeZoneInfo.FindSystemTimeZoneById("Europe/Istanbul"));
        var today = new DateTimeOffset(local.Year, local.Month, local.Day, 0, 0, 0, local.Offset).ToUniversalTime();
        var monday = today.AddDays(-(((int)local.DayOfWeek + 6) % 7));
        var since = now.AddDays(-7);
        var stations = await db.Stations.Where(s => s.DistrictId == district.Id && s.Status != StationStatus.Removed)
            .OrderBy(s => s.Name).ThenBy(s => s.Id)
            .Select(s => new { s.Name, s.Kind, s.Species, s.LastFedAt, s.Location, s.Status, s.FeedingsCount }).ToListAsync(ct);
        var stationRows = stations.Select(s => new StationRow(string.IsNullOrWhiteSpace(s.Name) ? "İsimsiz istasyon" : s.Name,
            s.Kind, s.Species, s.LastFedAt is null ? LastFedBucket.Never : s.LastFedAt >= today ? LastFedBucket.Today
                : s.LastFedAt >= monday ? LastFedBucket.ThisWeek : LastFedBucket.Older,
            Math.Round(s.Location.Latitude, 3), Math.Round(s.Location.Longitude, 3))
        { NeedsRefill = s.Status == StationStatus.NeedsRefill, TotalFeedings = s.FeedingsCount }).ToArray();
        var feedingCount = await db.Feedings.CountAsync(f => f.At >= since && f.At <= now
            && db.Stations.Any(s => s.Id == f.StationId && s.DistrictId == district.Id), ct);
        var adoptionCount = await db.AdoptionPosts.CountAsync(p => p.DistrictId == district.Id
            && p.State == AdoptionPostState.Published && p.ClosesAt > now
            && db.Animals.Any(a => a.Id == p.AnimalId && a.Status != AnimalStatus.Adopted), ct);
        return new DistrictSummary(district.Name, district.Slug, district.ProvinceName, district.ProvinceSlug,
            stationRows.Length, feedingCount, adoptionCount, stationRows,
            await carePlaces.ListAsync(districtSlug: districtSlug, ct: ct),
            await adoptions.ListAsync(provinceSlug, districtSlug, pageSize: 6, ct: ct));
    }
}
