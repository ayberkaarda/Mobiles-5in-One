using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Patika.Domain;
using Patika.Domain.Entities;
using Xunit;

namespace Patika.Web.Tests.Pages;

/// <summary>
/// The shared PostGIS database plus a few more public rows, served by the real web app on a fixed clock.
/// </summary>
public sealed class PageFixture : IAsyncLifetime
{
    public PostgisFixture Database { get; } = new();
    public WebApplicationFactory<Program> Factory { get; private set; } = null!;
    public string CatSlug { get; private set; } = "";
    public string DogSlug { get; private set; } = "";
    public string VetSlug { get; private set; } = "";
    public string ShelterSlug { get; private set; } = "";

    public async ValueTask InitializeAsync()
    {
        await Database.InitializeAsync();
        await using (var db = Database.CreateContext())
        {
            var dog = new Animal
            {
                CreatedBy = PostgisFixture.UserId,
                Name = "Karabaş",
                Species = Species.Dog,
                Sex = AnimalSex.Male,
                Sterilized = true,
                Vaccinated = true,
                EarTagged = true,
                District = "Üsküdar",
                BirthYear = 2022,
                Location = new GeoPoint(29.05, 41.02)
            };
            db.Animals.Add(dog);
            var post = new AdoptionPost
            {
                AnimalId = dog.Id,
                CreatedBy = PostgisFixture.UserId,
                District = "Üsküdar",
                State = AdoptionPostState.Published,
                ClosesAt = PostgisFixture.Now.AddDays(30),
                Description = "Sakin bir köpek.",
                Requirements = "Bahçeli bir ev."
            };
            db.AdoptionPosts.Add(post);
            db.AnimalPhotos.Add(new AnimalPhoto
            {
                AnimalId = dog.Id,
                CreatedBy = PostgisFixture.UserId,
                Key = "animal/70000000-0000-0000-0000-000000000001",
                ModerationState = ModerationState.Approved
            });
            var vet = new CarePlace
            {
                Name = "Kuşdili Veteriner Kliniği",
                Kind = CarePlaceKind.Vet,
                Address = "Kuşdili Cad. No: 12",
                District = "Kadıköy",
                Phone = "0216 000 00 00",
                Open24h = true,
                Verified = true,
                Location = new GeoPoint(29.03, 40.99)
            };
            var shelter = new CarePlace
            {
                Name = "Üsküdar Barınağı",
                Kind = CarePlaceKind.Shelter,
                Address = "Bulgurlu",
                District = "Üsküdar",
                HoursJson = """{"mon":"09:00-17:00","tue":"09:00-17:00","sun":"closed"}""",
                Location = new GeoPoint(29.06, 41.01)
            };
            db.CarePlaces.AddRange(vet, shelter);
            db.Stations.Add(new Station
            {
                Name = "Kuşdili köşesi",
                Location = new GeoPoint(29.0312345, 40.9912345),
                Kind = StationKind.Food,
                Species = Species.Cat,
                PhotoKey = "station/refill",
                District = "Kadıköy",
                CreatedBy = PostgisFixture.UserId,
                Status = StationStatus.NeedsRefill,
                FeedingsCount = 1284
            });
            await db.SaveChangesAsync();
            CatSlug = await db.AdoptionPosts.Where(p => p.Id == PostgisFixture.PostId).Select(p => p.Slug).SingleAsync();
            DogSlug = post.Slug;
            VetSlug = vet.Slug;
            ShelterSlug = shelter.Slug;
        }

        Factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:PatikaRead", Database.ConnectionString);
            builder.UseSetting("Storage:PublicBaseUrl", "https://media.example.org");
            builder.UseSetting("Web:PublicBaseUrl", "https://patika.test");
            builder.ConfigureServices(services => services.Replace(ServiceDescriptor.Singleton<TimeProvider>(new FixedClock())));
        });
    }

    public async ValueTask DisposeAsync()
    {
        if (Factory is not null) await Factory.DisposeAsync();
        await Database.DisposeAsync();
    }
}
