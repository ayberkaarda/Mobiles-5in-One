using Patika.Contracts.Geo;

namespace Patika.Contracts.Community;

public sealed record StationRequest(CoordinateDto Location, string Kind, string Species, string PhotoKey, string? Name = null);
public sealed record StationUpdateRequest(CoordinateDto? Location = null, string? Kind = null, string? Species = null, string? PhotoKey = null, string? Name = null);
public sealed record FeedingRequest(string? PhotoKey = null, string? Note = null);
public sealed record AnimalRequest(CoordinateDto Location, string Species, string Sex, string Status, string? Name = null, Guid? StationId = null, bool Sterilized = false, bool Vaccinated = false, bool EarTagged = false);
public sealed record AnimalUpdateRequest(CoordinateDto? Location = null, string? Species = null, string? Sex = null, string? Status = null, string? Name = null, Guid? StationId = null, bool? Sterilized = null, bool? Vaccinated = null, bool? EarTagged = null);
public sealed record AnimalPhotoRequest(string Key);
public sealed record SightingRequest(string? Note = null);
public sealed record PageResponse<T>(IReadOnlyList<T> Items, int Page, int PageSize, bool HasMore);
public sealed record MapFeature(Guid? Id, double Latitude, double Longitude, int Count);
public sealed record StationResponse(Guid Id, string? Name, CoordinateDto Location, string Kind, string Species, string PhotoKey, string Status, DateTimeOffset? LastFedAt, long FeedingsCount);
public sealed record FeedingResponse(Guid Id, DateTimeOffset At, string? PhotoKey, string? Note);
public sealed record AnimalResponse(Guid Id, Guid? StationId, CoordinateDto Location, string Species, string? Name, string Sex, bool Sterilized, bool Vaccinated, bool EarTagged, string Status);
public sealed record AnimalPhotoResponse(Guid Id, string Key);
public sealed record SightingResponse(Guid Id, DateTimeOffset At, string? Note);
public sealed class MapQuery(string Bbox = "", int Zoom = 14, int Page = 1, int PageSize = 100, string? Kind = null, string? Species = null, bool? NeedsRefill = null)
{
    public string Bbox { get; set; } = Bbox;
    public int Zoom { get; set; } = Zoom;
    public int Page { get; set; } = Page;
    public int PageSize { get; set; } = PageSize;
    public string? Kind { get; set; } = Kind;
    public string? Species { get; set; } = Species;
    public bool? NeedsRefill { get; set; } = NeedsRefill;
}
public sealed class PageQuery(int Page = 1, int PageSize = 10)
{
    public int Page { get; set; } = Page;
    public int PageSize { get; set; } = PageSize;
}
