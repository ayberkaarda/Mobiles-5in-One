using Microsoft.EntityFrameworkCore;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;

namespace Patika.Infrastructure.Seed;

public static class SampleDataSeeder
{
    public static async Task SeedAsync(PatikaDbContext context, CancellationToken cancellationToken = default)
    {
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
        foreach (var row in CreateRows())
        {
            if (await context.FindAsync(row.GetType(), [row.Id], cancellationToken) is null)
            {
                context.Add(row);
            }
        }

        await context.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public static IReadOnlyList<Entity> CreateRows()
    {
        var owner = new User
        {
            Id = SampleId(1),
            DisplayName = "[ÖRNEK] Kadıköy Gönüllüsü",
            District = "Kadıköy",
            DeactivatedAt = DateTimeOffset.Parse("2026-01-01T00:00:00Z")
        };
        var moda = new Station
        {
            Id = SampleId(2),
            Name = "[ÖRNEK] Moda Mama ve Su Noktası",
            Location = new GeoPoint(29.0265, 40.9806),
            Kind = StationKind.Both,
            Species = Species.Cat,
            PhotoKey = "samples/moda-station.jpg",
            District = "Kadıköy",
            CreatedBy = owner.Id
        };
        var yeldegirmeni = new Station
        {
            Id = SampleId(3),
            Name = "[ÖRNEK] Yeldeğirmeni Su Noktası",
            Location = new GeoPoint(29.0288, 40.9965),
            Kind = StationKind.Water,
            Species = Species.Mixed,
            PhotoKey = "samples/yeldegirmeni-station.jpg",
            District = "Kadıköy",
            CreatedBy = owner.Id
        };
        var cat = new Animal
        {
            Id = SampleId(4),
            Name = "[ÖRNEK] Tekir",
            StationId = moda.Id,
            Location = moda.Location,
            Species = Species.Cat,
            Sex = AnimalSex.Female,
            Sterilized = true,
            Vaccinated = true,
            Status = AnimalStatus.Healthy,
            District = "Kadıköy",
            CreatedBy = owner.Id
        };
        var dog = new Animal
        {
            Id = SampleId(5),
            Name = "[ÖRNEK] Boncuk",
            StationId = yeldegirmeni.Id,
            Location = yeldegirmeni.Location,
            Species = Species.Dog,
            Sex = AnimalSex.Male,
            EarTagged = true,
            Status = AnimalStatus.Healthy,
            District = "Kadıköy",
            CreatedBy = owner.Id
        };
        return
        [
            owner, moda, yeldegirmeni, cat, dog,
            new AdoptionPost
            {
                Id = SampleId(6), AnimalId = cat.Id, Description = "[ÖRNEK] Tekir için temsili sahiplendirme ilanı.",
                Requirements = "[ÖRNEK] Bu ilan gerçek bir başvuru kabul etmez.", District = "Kadıköy",
                State = AdoptionPostState.Pending, ClosesAt = DateTimeOffset.Parse("2026-12-01T00:00:00Z"), CreatedBy = owner.Id
            },
            new AdoptionPost
            {
                Id = SampleId(7), AnimalId = dog.Id, Description = "[ÖRNEK] Boncuk için temsili sahiplendirme ilanı.",
                Requirements = "[ÖRNEK] Bu ilan gerçek bir başvuru kabul etmez.", District = "Kadıköy",
                State = AdoptionPostState.Pending, ClosesAt = DateTimeOffset.Parse("2026-12-01T00:00:00Z"), CreatedBy = owner.Id
            },
            new CarePlace
            {
                Id = SampleId(8), Name = "[ÖRNEK] Kadıköy Veteriner Noktası", Kind = CarePlaceKind.Vet,
                Location = new GeoPoint(29.0300, 40.9850), Address = "[ÖRNEK] Kadıköy, İstanbul; gerçek işletme değildir.",
                District = "Kadıköy", HoursJson = "{}", IsSample = true
            },
            new CarePlace
            {
                Id = SampleId(9), Name = "[ÖRNEK] Kadıköy Bakımevi", Kind = CarePlaceKind.Shelter,
                Location = new GeoPoint(29.0400, 40.9900), Address = "[ÖRNEK] Kadıköy, İstanbul; gerçek işletme değildir.",
                District = "Kadıköy", HoursJson = "{}", IsSample = true
            },
            new CarePlace
            {
                Id = SampleId(10), Name = "[ÖRNEK] Kadıköy Belediye Bakım Noktası", Kind = CarePlaceKind.MunicipalCare,
                Location = new GeoPoint(29.0450, 40.9950), Address = "[ÖRNEK] Kadıköy, İstanbul; gerçek işletme değildir.",
                District = "Kadıköy", HoursJson = "{}", IsSample = true
            }
        ];
    }

    private static Guid SampleId(int value) => Guid.Parse($"019ba150-0000-7000-8000-{value:x12}");
}
