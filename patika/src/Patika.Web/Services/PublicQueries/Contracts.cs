using Patika.Domain.Entities;

namespace Patika.Web.Services.PublicQueries;

public sealed record AdoptionCard(string Slug, string? AnimalName, Species Species, AnimalSex Sex, short? BirthYear,
    string? DistrictName, string? DistrictSlug, bool Sterilized, bool Vaccinated, string? ThumbUrl)
{
    public bool EarTagged { get; init; }

    /// <summary>When the post closes on its own (60 days after publishing).</summary>
    public DateTimeOffset ClosesAt { get; init; }
}
public sealed record AdoptionDetail(AdoptionCard Card, string Description, string Requirements, DateTimeOffset ClosesAt, IReadOnlyList<string> Photos);
public sealed record ProvinceSummary(string Name, string Slug);
public enum LastFedBucket { Today, ThisWeek, Older, Never }
/// <summary>No photo: station photos are not moderated, so the public site never shows them.</summary>
public sealed record StationRow(string Name, StationKind Kind, Species Species, LastFedBucket LastFed, double Latitude, double Longitude)
{
    /// <summary>The station is marked as out of food (StationStatus.NeedsRefill).</summary>
    public bool NeedsRefill { get; init; }

    /// <summary>All feedings ever recorded at the station; a count only, never who fed.</summary>
    public long TotalFeedings { get; init; }
}
public sealed record DistrictListItem(string Name, string Slug, int ActiveStations, int OpenAdoptions);
public sealed record ProvinceDetail(string Name, string Slug, IReadOnlyList<DistrictListItem> Districts);
public sealed record DistrictSummary(string Name, string Slug, string ProvinceName, string ProvinceSlug, int ActiveStations,
    int FeedingsLastSevenDays, int OpenAdoptions, IReadOnlyList<StationRow> Stations, IReadOnlyList<CarePlaceView> CarePlaces, IReadOnlyList<AdoptionCard> Adoptions);
public sealed record CarePlaceView(string Slug, string Name, CarePlaceKind Kind, string Address, string? Phone,
    string? Website, string? HoursJson, bool Open24h, bool Verified, string? DistrictName, string? DistrictSlug);
public sealed record ImpactWeek(DateOnly StartsOn, int Feedings, int NewStations, int Adoptions, int UrgentPostsHandled);
public sealed record ImpactSummary(IReadOnlyList<ImpactWeek> Weeks, ImpactWeek LastWeek, string MethodNote);
public sealed record SitemapEntry(string Url, DateTimeOffset LastModified);

public interface IAdoptionQueries
{
    Task<IReadOnlyList<AdoptionCard>> ListAsync(string? provinceSlug = null, string? districtSlug = null, Species? species = null,
        int page = 1, int pageSize = 24, CancellationToken ct = default);
    Task<AdoptionDetail?> GetBySlugAsync(string slug, CancellationToken ct = default);
    Task<int> CountAsync(string? provinceSlug = null, string? districtSlug = null, Species? species = null, CancellationToken ct = default);
}
public interface IPlaceQueries
{
    Task<IReadOnlyList<ProvinceSummary>> ListProvincesAsync(CancellationToken ct = default);
    Task<DistrictSummary?> GetDistrictAsync(string provinceSlug, string districtSlug, CancellationToken ct = default);
    /// <summary>The province with every district, active districts first, then by Turkish name; null when the slug is unknown.</summary>
    Task<ProvinceDetail?> GetProvinceAsync(string provinceSlug, CancellationToken ct = default);
    /// <summary>Every district of every province with its counts, in one query; Turkish name order.</summary>
    Task<IReadOnlyList<DistrictListItem>> ListDistrictsAsync(CancellationToken ct = default);
}
public interface ICarePlaceQueries
{
    /// <summary>Care places by name; <paramref name="limit"/> caps the rows in SQL for small panels.</summary>
    Task<IReadOnlyList<CarePlaceView>> ListAsync(CarePlaceKind? kind = null, bool? open24h = null, string? districtSlug = null,
        int? limit = null, CancellationToken ct = default);
    Task<CarePlaceView?> GetBySlugAsync(string slug, CancellationToken ct = default);
}
public interface IImpactQueries
{
    Task<ImpactSummary> GetAsync(CancellationToken ct = default);
}
public interface ISitemapQueries
{
    Task<IReadOnlyList<SitemapEntry>> ListAsync(int page = 1, CancellationToken ct = default);
}
