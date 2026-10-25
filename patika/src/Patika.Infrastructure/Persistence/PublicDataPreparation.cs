using Microsoft.EntityFrameworkCore;
using Patika.Domain;
using Patika.Domain.Entities;

namespace Patika.Infrastructure.Persistence;

/// <summary>
/// Runs before every save: links free-text districts to the seeded district table, assigns the public
/// slugs once (they never change afterwards), and enforces the few invariants the public site relies on.
/// The migration <c>Phase4Data</c> applies the same rules to rows that existed before it.
/// </summary>
internal static class PublicDataPreparation
{
    public static void Prepare(PatikaDbContext db)
    {
        db.ChangeTracker.DetectChanges();
        if (db.ChangeTracker.Entries<ModerationDecision>().Any(e => e.State is EntityState.Modified or EntityState.Deleted))
            throw new InvalidOperationException("Moderation decisions are append-only.");
        var entries = db.ChangeTracker.Entries<Entity>().Where(e => e.State is EntityState.Added or EntityState.Modified).ToArray();
        var pendingSlugs = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entry in entries)
        {
            string? district = entry.Entity switch
            {
                Station s => s.District,
                Animal a => a.District,
                AdoptionPost p => p.District,
                CarePlace p => p.District,
                _ => null
            };
            if (entry.Entity is Station or Animal or AdoptionPost or CarePlace
                && ((entry.State == EntityState.Added && entry.Property("DistrictId").CurrentValue is null)
                    || (entry.State == EntityState.Modified && entry.Property("District").IsModified)))
            {
                entry.Property("DistrictId").CurrentValue = ResolveDistrict(db, district);
            }
            if (entry.Entity is Animal animal && animal.BirthYear is { } year && (year < 1990 || year > CurrentYear()))
                throw new InvalidOperationException("Birth year is outside the supported range.");
            if (entry.Entity is AdoptionPost post)
            {
                if (entry.State == EntityState.Modified) entry.Property(nameof(post.Slug)).IsModified = false;
                else if (post.Slug.Length == 0)
                {
                    var source = db.Animals.Local.FirstOrDefault(a => a.Id == post.AnimalId) ?? db.Animals.Find(post.AnimalId);
                    var basis = Slug.From($"{source?.Name ?? source?.Species.ToString() ?? "animal"}-{DistrictSlug(db, post.DistrictId)}");
                    post.Slug = Unique($"{basis}-{post.Id.ToString("N")[..6]}", pendingSlugs, slug => db.AdoptionPosts.Any(p => p.Slug == slug));
                }
            }
            if (entry.Entity is CarePlace place)
            {
                if (place.Website is not null && (!Uri.TryCreate(place.Website, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps))
                    throw new InvalidOperationException("Website must use HTTPS.");
                if (entry.State == EntityState.Modified) entry.Property(nameof(place.Slug)).IsModified = false;
                else if (place.Slug.Length == 0)
                {
                    var basis = Slug.From($"{place.Name}-{DistrictSlug(db, place.DistrictId)}");
                    place.Slug = Unique(basis, pendingSlugs, slug => db.CarePlaces.Any(p => p.Slug == slug));
                }
            }
        }
    }

    /// <summary>Same rule as <see cref="DistrictResolver"/>: the free text must slugify to a seeded İstanbul district.</summary>
    private static Guid? ResolveDistrict(PatikaDbContext db, string? district)
    {
        if (string.IsNullOrWhiteSpace(district)) return null;
        var slug = Slug.From(district);
        return db.Districts.Where(d => d.Slug == slug && d.ProvinceId == IstanbulDistricts.ProvinceId)
            .Select(d => (Guid?)d.Id).SingleOrDefault();
    }

    private static string? DistrictSlug(PatikaDbContext db, Guid? districtId) => districtId is null ? null
        : db.Districts.Where(d => d.Id == districtId).Select(d => d.Slug).SingleOrDefault();

    /// <summary>The candidate itself, else the first free <c>{candidate}-2</c>, <c>-3</c>, ...</summary>
    private static string Unique(string candidate, HashSet<string> pending, Func<string, bool> taken)
    {
        var slug = candidate;
        for (var suffix = 2; pending.Contains(slug) || taken(slug); suffix++) slug = $"{candidate}-{suffix}";
        pending.Add(slug);
        return slug;
    }

    /// <summary>Calendar year in Türkiye (UTC+3), matching the API validator.</summary>
    private static int CurrentYear() => DateTimeOffset.UtcNow.ToOffset(TimeSpan.FromHours(3)).Year;
}
