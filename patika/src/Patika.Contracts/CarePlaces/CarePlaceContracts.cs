namespace Patika.Contracts.CarePlaces;

public sealed record CarePlaceResponse(Guid Id, string Name, string Kind, double Latitude, double Longitude,
    string Address, string? Phone, string? HoursJson, bool Open24h, bool Verified, bool IsSample);
public sealed record CarePlaceImportResponse(int Imported);
