namespace Patika.Contracts.Dto;

public sealed record LocationDto(double Longitude, double Latitude);

public sealed record StationDto(
    Guid Id, LocationDto Location, string Kind, string Species,
    string Status, DateTimeOffset? LastFedAt, long FeedingsCount);

public sealed record AnimalDto(
    Guid Id, Guid? StationId, LocationDto Location, string Species,
    string? Name, string Status);

public sealed record PageDto<T>(IReadOnlyList<T> Items, string? NextCursor);
