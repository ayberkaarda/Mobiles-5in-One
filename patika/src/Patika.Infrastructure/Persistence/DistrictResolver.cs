using Microsoft.EntityFrameworkCore;
using Patika.Domain;
using Patika.Domain.Entities;

namespace Patika.Infrastructure.Persistence;

public interface IDistrictResolver
{
    Task<Guid?> ResolveAsync(string? text, CancellationToken ct = default);
}

public sealed class DistrictResolver(PatikaDbContext db) : IDistrictResolver
{
    public Task<Guid?> ResolveAsync(string? text, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(text)) return Task.FromResult<Guid?>(null);
        var slug = Slug.From(text);
        return db.Districts.Where(d => d.Slug == slug && db.Provinces.Any(p => p.Id == d.ProvinceId && p.Slug == "istanbul"))
            .Select(d => (Guid?)d.Id).SingleOrDefaultAsync(ct);
    }
}

public static class IstanbulDistricts
{
    public static readonly Guid ProvinceId = new("34000000-0000-0000-0000-000000000000");
    public static readonly string[] Names =
    [
        "Adalar", "Arnavutköy", "Ataşehir", "Avcılar", "Bağcılar", "Bahçelievler", "Bakırköy", "Başakşehir",
        "Bayrampaşa", "Beşiktaş", "Beykoz", "Beylikdüzü", "Beyoğlu", "Büyükçekmece", "Çatalca", "Çekmeköy",
        "Esenler", "Esenyurt", "Eyüpsultan", "Fatih", "Gaziosmanpaşa", "Güngören", "Kadıköy", "Kağıthane",
        "Kartal", "Küçükçekmece", "Maltepe", "Pendik", "Sancaktepe", "Sarıyer", "Silivri", "Sultanbeyli",
        "Sultangazi", "Şile", "Şişli", "Tuzla", "Ümraniye", "Üsküdar", "Zeytinburnu"
    ];
    public static Guid Id(int index) => Guid.Parse($"34000000-0000-0000-0000-{index + 1:000000000000}");
}
