using Microsoft.EntityFrameworkCore;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;

namespace Patika.Web.Services.PublicQueries;

public sealed class CarePlaceQueries(PatikaDbContext db, IConfiguration configuration) : ICarePlaceQueries
{
    private IQueryable<CarePlace> PublicPlaces => db.CarePlaces.Where(p => !p.IsSample || configuration.GetValue<bool>("Web:ShowSamples"));

    public async Task<IReadOnlyList<CarePlaceView>> ListAsync(CarePlaceKind? kind = null, bool? open24h = null,
        string? districtSlug = null, CancellationToken ct = default)
    {
        var query = PublicPlaces;
        if (kind is not null) query = query.Where(p => p.Kind == kind);
        if (open24h is not null) query = query.Where(p => p.Open24h == open24h);
        if (districtSlug is not null) query = query.Where(p => db.Districts.Any(d => d.Id == p.DistrictId && d.Slug == districtSlug));
        return await Views(query.OrderBy(p => p.Name).ThenBy(p => p.Id)).ToListAsync(ct);
    }

    public Task<CarePlaceView?> GetBySlugAsync(string slug, CancellationToken ct = default) =>
        Views(PublicPlaces.Where(p => p.Slug == slug)).SingleOrDefaultAsync(ct);

    private IQueryable<CarePlaceView> Views(IQueryable<CarePlace> query) => query.Select(p => new CarePlaceView(
        p.Slug, p.Name, p.Kind, p.Address, p.Phone, p.Website, p.HoursJson, p.Open24h, p.Verified,
        db.Districts.Where(d => d.Id == p.DistrictId).Select(d => d.Name).FirstOrDefault(),
        db.Districts.Where(d => d.Id == p.DistrictId).Select(d => d.Slug).FirstOrDefault()));
}
