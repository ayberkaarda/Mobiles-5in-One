using Microsoft.EntityFrameworkCore;
using Patika.Domain.Entities;
using Patika.Infrastructure.Media;
using Patika.Infrastructure.Persistence;

namespace Patika.Web.Services.PublicQueries;

public sealed class AdoptionQueries(PatikaDbContext db, IPhotoUrlResolver photos, TimeProvider clock) : IAdoptionQueries
{
    private IQueryable<AdoptionPost> PublicPosts => db.AdoptionPosts.Where(p => p.State == AdoptionPostState.Published
        && p.ClosesAt > clock.GetUtcNow() && db.Animals.Any(a => a.Id == p.AnimalId && a.Status != AnimalStatus.Adopted));

    public async Task<IReadOnlyList<AdoptionCard>> ListAsync(string? provinceSlug = null, string? districtSlug = null,
        Species? species = null, int page = 1, int pageSize = 24, CancellationToken ct = default)
    {
        if (page is < 1 or > 100000 || pageSize is < 1 or > 24) throw new ArgumentOutOfRangeException(nameof(page));
        var query = PublicPosts;
        if (districtSlug is not null) query = query.Where(p => db.Districts.Any(d => d.Id == p.DistrictId && d.Slug == districtSlug));
        if (provinceSlug is not null) query = query.Where(p => db.Districts.Any(d => d.Id == p.DistrictId
            && db.Provinces.Any(province => province.Id == d.ProvinceId && province.Slug == provinceSlug)));
        if (species is not null) query = query.Where(p => db.Animals.Any(a => a.Id == p.AnimalId && a.Species == species));
        return await CardsAsync(query.OrderByDescending(p => p.CreatedAt).ThenByDescending(p => p.Id).Skip((page - 1) * pageSize).Take(pageSize), ct);
    }

    private async Task<IReadOnlyList<AdoptionCard>> CardsAsync(IQueryable<AdoptionPost> query, CancellationToken ct)
    {
        var rows = await (from post in query
                          join animal in db.Animals on post.AnimalId equals animal.Id
                          select new
                          {
                              post.Slug,
                              animal.Name,
                              animal.Species,
                              animal.Sex,
                              animal.BirthYear,
                              animal.Sterilized,
                              animal.Vaccinated,
                              DistrictName = db.Districts.Where(d => d.Id == post.DistrictId).Select(d => d.Name).FirstOrDefault(),
                              DistrictSlug = db.Districts.Where(d => d.Id == post.DistrictId).Select(d => d.Slug).FirstOrDefault(),
                              Key = db.AnimalPhotos.Where(p => p.AnimalId == animal.Id && p.ModerationState == ModerationState.Approved)
                                  .OrderBy(p => p.CreatedAt).ThenBy(p => p.Id).Select(p => p.Key).FirstOrDefault()
                          }).ToListAsync(ct);
        return rows.Select(r => new AdoptionCard(r.Slug, r.Name, r.Species, r.Sex, r.BirthYear, r.DistrictName,
            r.DistrictSlug, r.Sterilized, r.Vaccinated, photos.Resolve(r.Key, PhotoSize.Thumbnail))).ToArray();
    }

    public async Task<AdoptionDetail?> GetBySlugAsync(string slug, CancellationToken ct = default)
    {
        var query = PublicPosts.Where(p => p.Slug == slug);
        var detail = await query.Select(p => new { p.Description, p.Requirements, p.ClosesAt, p.AnimalId }).SingleOrDefaultAsync(ct);
        if (detail is null) return null;
        var cards = await CardsAsync(query, ct);
        var keys = await db.AnimalPhotos.Where(p => p.AnimalId == detail.AnimalId && p.ModerationState == ModerationState.Approved)
            .OrderBy(p => p.CreatedAt).ThenBy(p => p.Id).Select(p => p.Key).ToListAsync(ct);
        return new AdoptionDetail(cards[0], detail.Description, detail.Requirements, detail.ClosesAt,
            keys.Select(k => photos.Resolve(k, PhotoSize.Medium)).OfType<string>().ToArray());
    }
}
