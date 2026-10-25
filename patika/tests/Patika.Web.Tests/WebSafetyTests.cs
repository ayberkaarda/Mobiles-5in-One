using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;
using Patika.Web.Routing;
using Patika.Web.Services;
using Patika.Web.Services.PublicQueries;
using Xunit;

namespace Patika.Web.Tests;

public sealed class WebSafetyTests
{
    private const string ReadOnlyMessage = PublicReadContext.ReadOnlyMessage;

    [Fact]
    public async Task MissingPagesReturn404AndSecurityHeaders()
    {
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:PatikaRead", "Host=localhost;Port=1;Database=unused");
        });
        using var client = factory.CreateClient();
        foreach (var path in new[] { "/404", "/does-not-exist" })
        {
            using var response = await client.GetAsync(path, TestContext.Current.CancellationToken);
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
            Assert.Equal("nosniff", Assert.Single(response.Headers.GetValues("X-Content-Type-Options")));
            Assert.Contains("default-src 'self'", Assert.Single(response.Headers.GetValues("Content-Security-Policy")), StringComparison.Ordinal);
            Assert.Equal("strict-origin-when-cross-origin", Assert.Single(response.Headers.GetValues("Referrer-Policy")));
        }

        using var health = await client.GetAsync("/healthz", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, health.StatusCode);
    }

    [Fact]
    public async Task TheRegisteredContextIsTheReadOnlyNoTrackingOne()
    {
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:PatikaRead", "Host=localhost;Port=1;Database=unused");
        });
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<PatikaDbContext>();
        Assert.IsType<PublicReadContext>(db);
        Assert.Equal(QueryTrackingBehavior.NoTracking, db.ChangeTracker.QueryTrackingBehavior);
        Assert.Equal(ReadOnlyMessage, Assert.Throws<InvalidOperationException>(() => db.SaveChanges()).Message);
    }

    [Fact]
    public async Task ReadContextRefusesBothSavePathsWithoutConnecting()
    {
        await using var db = new PublicReadContext(new DbContextOptionsBuilder<PatikaDbContext>()
            .UseNpgsql("Host=localhost;Port=1;Database=unused", pg => pg.UseNetTopologySuite())
            .UseQueryTrackingBehavior(QueryTrackingBehavior.NoTracking).Options);
        Assert.Equal(QueryTrackingBehavior.NoTracking, db.ChangeTracker.QueryTrackingBehavior);
        db.Animals.Add(new Animal { District = "Kadıköy" });
        // The message proves the override refused the save, not a failed connection to the unused host.
        Assert.Equal(ReadOnlyMessage, Assert.Throws<InvalidOperationException>(() => db.SaveChanges()).Message);
        Assert.Equal(ReadOnlyMessage, (await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync(TestContext.Current.CancellationToken))).Message);
    }

    [Fact]
    public void PublicRecordsExposeNoIdentityOrEntities()
    {
        var types = typeof(AdoptionCard).Assembly.GetTypes().Where(t => t.Namespace == typeof(AdoptionCard).Namespace
            && t.GetMethod("<Clone>$") is not null).ToArray();
        Assert.NotEmpty(types);
        foreach (var type in types)
        {
            foreach (var property in type.GetProperties())
            {
                Assert.DoesNotContain(property.Name, new[] { "UserId", "CreatedBy", "ReviewerId", "Email", "DisplayName", "AuthorDisplayName", "Creator" });
                Assert.False(typeof(Entity).IsAssignableFrom(property.PropertyType));
                Assert.NotEqual(typeof(Guid), property.PropertyType);
                Assert.NotEqual(typeof(Guid?), property.PropertyType);
            }
        }
    }

    [Fact]
    public void RoutesAreLowercaseAndHaveNoTrailingSlash()
    {
        Assert.Equal("/sahiplendirme/pamuk", Routes.Adoption("PAMUK/"));
        Assert.Equal("/istasyonlar/istanbul/kadikoy", Routes.District("ISTANBUL", "KADIKOY"));
        Assert.Equal("/bakim-yeri/klinik", Routes.CarePlace("KLINIK"));
        Assert.Equal("/rehber/besleme", Routes.Guide("BESLEME"));
    }
}
