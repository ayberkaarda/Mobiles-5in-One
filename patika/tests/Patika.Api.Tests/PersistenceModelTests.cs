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
            "admin_access_tokens", "adoption_posts", "adoption_requests", "animal_photos", "animals",
            "audit_logs", "care_place_imports", "care_places", "deletion_requests",
            "device_tokens", "districts", "email_tokens", "external_logins", "fake_play_purchases", "feedings", "follows", "idempotency_keys",
            "moderation_decisions", "play_notifications", "provinces", "push_daily_counters", "refresh_tokens",
            "reports", "sightings", "stations", "subscriptions", "totp_recovery_codes", "uploads", "urgent_posts", "users"
        ];

        Assert.Equal(expected, tables);
        var expectedColumns = new Dictionary<Type, string[]>
        {
            [typeof(Upload)] =
            [
                "content_length", "content_type", "created_at", "failure_code", "id", "key",
                "kind", "processed_at", "state", "updated_at", "user_id"
            ],
            [typeof(PushDailyCounter)] = ["channel", "count", "day"],
            [typeof(DeviceToken)] =
            [
                "created_at", "environment", "id", "installation_id", "last_seen_at", "token",
                "updated_at", "user_id"
            ],
            [typeof(UrgentPost)] =
            [
                "category", "created_at", "created_by", "description", "fanout_at", "hidden_at", "hidden_reason", "id",
                "location", "notified_count", "photo_key", "state", "updated_at"
            ]
        };
        foreach (var (type, columns) in expectedColumns)
        {
            var entity = context.Model.FindEntityType(type);
            Assert.NotNull(entity);
            Assert.Equal(columns, entity.GetProperties()
                .Select(property => property.GetColumnName())
                .OrderBy(name => name, StringComparer.Ordinal)
                .ToArray());
        }

        var deviceToken = context.Model.FindEntityType(typeof(DeviceToken));
        Assert.NotNull(deviceToken);
        var installationIndex = Assert.Single(deviceToken.GetIndexes(), index =>
            index.Properties.Any(property => property.Name == nameof(DeviceToken.InstallationId)));
        Assert.True(installationIndex.IsUnique);
        Assert.Equal(nameof(DeviceToken.InstallationId), Assert.Single(installationIndex.Properties).Name);

        var station = context.Model.FindEntityType(typeof(Station));
        Assert.NotNull(station);
        Assert.Equal("geography(Point,4326)", station.FindProperty(nameof(Station.Location))?.GetColumnType());
    }
}
