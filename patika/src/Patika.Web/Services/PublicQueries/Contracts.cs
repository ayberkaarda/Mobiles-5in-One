using Patika.Domain.Entities;

namespace Patika.Web.Services.PublicQueries;

public sealed record AdoptionCard(string Slug, string? AnimalName, Species Species, AnimalSex Sex, short? BirthYear,
    string? DistrictName, string? DistrictSlug, bool Sterilized, bool Vaccinated, string? ThumbUrl);
public sealed record AdoptionDetail(AdoptionCard Card, string Description, string Requirements, DateTimeOffset ClosesAt, IReadOnlyList<string> Photos);
public sealed record ProvinceSummary(string Name, string Slug);
public enum LastFedBucket { Today, ThisWeek, Older, Never }
/// <summary>No photo: station photos are not moderated, so the public site never shows them.</summary>
public sealed record StationRow(string Name, StationKind Kind, Species Species, LastFedBucket LastFed, double Latitude, double Longitude);
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
}
public interface IPlaceQueries
{
    Task<IReadOnlyList<ProvinceSummary>> ListProvincesAsync(CancellationToken ct = default);
    Task<DistrictSummary?> GetDistrictAsync(string provinceSlug, string districtSlug, CancellationToken ct = default);
}
public interface ICarePlaceQueries
{
    Task<IReadOnlyList<CarePlaceView>> ListAsync(CarePlaceKind? kind = null, bool? open24h = null, string? districtSlug = null, CancellationToken ct = default);
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
