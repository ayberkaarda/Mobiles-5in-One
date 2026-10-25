using Microsoft.EntityFrameworkCore;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;
using Patika.Web.Routing;

namespace Patika.Web.Services.PublicQueries;

public sealed class SitemapQueries(PatikaDbContext db, IConfiguration configuration, TimeProvider clock) : ISitemapQueries
{
    public async Task<IReadOnlyList<SitemapEntry>> ListAsync(int page = 1, CancellationToken ct = default)
    {
        if (page is < 1 or > 100000) throw new ArgumentOutOfRangeException(nameof(page));
        var now = clock.GetUtcNow();
        var posts = db.AdoptionPosts.Where(p => p.State == AdoptionPostState.Published && p.ClosesAt > now
            && db.Animals.Any(a => a.Id == p.AnimalId && a.Status != AnimalStatus.Adopted));
        var districts = from d in db.Districts
                        join p in db.Provinces on d.ProvinceId equals p.Id
                        where db.Stations.Any(s => s.DistrictId == d.Id && s.Status != StationStatus.Removed)
                            || posts.Any(post => post.DistrictId == d.Id)
                        select new { Path = "/istasyonlar/" + p.Slug + "/" + d.Slug, LastModified = d.UpdatedAt };
        var showSamples = configuration.GetValue<bool>("Web:ShowSamples");
        var query = posts.Select(p => new { Path = "/sahiplendirme/" + p.Slug, LastModified = p.UpdatedAt })
            .Concat(districts)
            .Concat(db.CarePlaces.Where(p => !p.IsSample || showSamples)
                .Select(p => new { Path = "/bakim-yeri/" + p.Slug, LastModified = p.UpdatedAt }));
        var rows = await query.OrderBy(r => r.Path).Skip((page - 1) * 10000).Take(10000).ToListAsync(ct);
        return rows.Select(r => new SitemapEntry(r.Path, r.LastModified)).ToArray();
    }
}
