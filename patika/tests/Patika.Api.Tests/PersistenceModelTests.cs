using Microsoft.EntityFrameworkCore;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;
using Xunit;

namespace Patika.Api.Tests;

public sealed class PersistenceModelTests
{
    [Fact]
    public void ModelMapsPersistentTablesAndSpatialColumnsWithoutConnecting()
    {
        var options = new DbContextOptionsBuilder<PatikaDbContext>()
            .UseNpgsql("Host=127.0.0.1;Database=patika", postgres => postgres.UseNetTopologySuite())
            .Options;
        using var context = new PatikaDbContext(options);

        var tables = context.Model.GetEntityTypes()
            .Select(entity => entity.GetTableName())
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();
        string[] expected =
        [
            "adoption_posts", "adoption_requests", "animal_photos", "animals",
            "app_store_notifications", "audit_logs", "care_places", "deletion_requests",
            "device_tokens", "email_tokens", "feedings", "follows", "refresh_tokens",
            "reports", "sightings", "stations", "subscriptions", "urgent_posts", "users"
        ];

        Assert.Equal(expected, tables);
        var station = context.Model.FindEntityType(typeof(Station));
        Assert.NotNull(station);
        Assert.Equal("geography(Point,4326)", station.FindProperty(nameof(Station.Location))?.GetColumnType());
    }
}
