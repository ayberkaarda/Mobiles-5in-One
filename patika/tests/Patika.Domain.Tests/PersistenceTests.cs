using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using NetTopologySuite.Geometries;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;
using Patika.Infrastructure.Seed;
using Xunit;

namespace Patika.Domain.Tests;

public sealed class PersistenceTests
{
    private static PatikaDbContext CreateContext(bool suppressWrites = false)
    {
        var options = new DbContextOptionsBuilder<PatikaDbContext>()
            .UseNpgsql("Host=localhost;Database=patika_model;Username=patika", postgres => postgres.UseNetTopologySuite());
        if (suppressWrites)
        {
            options.AddInterceptors(new SuppressWrites());
        }

        return new PatikaDbContext(options.Options);
    }

    [Fact]
    public void ModelCreatesEveryTableWithClientIdsAndTimestamps()
    {
        using var context = CreateContext();
        string[] tables =
        [
            "users", "refresh_tokens", "email_tokens", "external_logins", "stations", "feedings",
            "animals", "animal_photos", "sightings", "follows", "adoption_posts", "adoption_requests",
            "urgent_posts", "care_places", "device_tokens", "subscriptions", "app_store_notifications",
            "reports", "audit_logs", "deletion_requests"
        ];
        Assert.Equal(tables.Order(), context.Model.GetEntityTypes().Select(entity => entity.GetTableName()!).Order());
        foreach (var entity in context.Model.GetEntityTypes())
        {
            Assert.Null(entity.FindProperty("Id")!.GetDefaultValueSql());
            Assert.NotNull(entity.FindProperty("CreatedAt"));
            Assert.NotNull(entity.FindProperty("UpdatedAt"));
            Assert.All(entity.GetProperties(), property => Assert.DoesNotContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ".ToCharArray(),
                character => property.GetColumnName().Contains(character)));
        }

        var sql = context.Database.GenerateCreateScript();
        Assert.Contains("CREATE EXTENSION IF NOT EXISTS postgis", sql);
        Assert.Equal(4, sql.Split("USING gist").Length - 1);
        Assert.Contains("geography(Point,4326)", sql);
        var designModel = context.GetService<IDesignTimeModel>().Model;
        var operations = context.GetService<IMigrationsModelDiffer>()
            .GetDifferences(null, designModel.GetRelationalModel());
        Assert.NotEmpty(operations);
    }

    [Theory]
    [InlineData(typeof(Station))]
    [InlineData(typeof(Animal))]
    [InlineData(typeof(UrgentPost))]
    [InlineData(typeof(CarePlace))]
    public void LocationsUseGeographyAndGist(Type entityType)
    {
        using var context = CreateContext();
        var entity = context.Model.FindEntityType(entityType)!;
        Assert.Equal("geography(Point,4326)", entity.FindProperty("Location")!.GetColumnType());
        Assert.Contains(entity.GetIndexes(), index => index.GetMethod() == "gist"
            && index.Properties.Single().Name == "Location");
    }

    [Fact]
    public void IdentityHashesAndExternalSubjectsAreUnique()
    {
        using var context = CreateContext();
        foreach (var type in new[] { typeof(RefreshToken), typeof(EmailToken) })
        {
            var entity = context.Model.FindEntityType(type)!;
            Assert.Equal("bytea", entity.FindProperty("TokenHash")!.GetColumnType());
            Assert.Contains(entity.GetIndexes(), index => index.IsUnique && index.Properties.Single().Name == "TokenHash");
        }

        var login = context.Model.FindEntityType(typeof(ExternalLogin))!;
        Assert.Contains(login.GetIndexes(), index => index.IsUnique
            && index.Properties.Select(property => property.Name).SequenceEqual(["Provider", "Subject"]));
        Assert.NotNull(context.Model.FindEntityType(typeof(RefreshToken))!.FindProperty("ReplacedById"));
        Assert.NotNull(context.Model.FindEntityType(typeof(EmailToken))!.FindProperty("UsedAt"));
    }

    [Fact]
    public void UserDeletionAnonymizesHistoryAndRetainsSubscriptionHash()
    {
        using var context = CreateContext();
        foreach (var type in new[] { typeof(Feeding), typeof(Sighting), typeof(Subscription), typeof(AuditLog) })
        {
            var relationship = context.Model.FindEntityType(type)!.GetForeignKeys()
                .Single(key => key.PrincipalEntityType.ClrType == typeof(User));
            Assert.Equal(DeleteBehavior.SetNull, relationship.DeleteBehavior);
            Assert.True(relationship.Properties.Single().IsNullable);
        }
    }

    [Fact]
    public void CoordinatesRoundTripWithoutAxisSwap()
    {
        var converter = new GeoPointConverter();
        var point = (Point)converter.ConvertToProvider(new GeoPoint(29.0265, 40.9806))!;
        Assert.Equal(4326, point.SRID);
        Assert.Equal(29.0265, point.X);
        Assert.Equal(40.9806, point.Y);
        Assert.Equal(new GeoPoint(29.0265, 40.9806), converter.ConvertFromProvider(point));
    }

    [Fact]
    public void SampleRowsHaveStableVersionSevenIdsAndExplicitLabels()
    {
        var first = SampleDataSeeder.CreateRows();
        var second = SampleDataSeeder.CreateRows();
        Assert.Equal(first.Select(row => row.Id), second.Select(row => row.Id));
        Assert.Equal(first.Count, first.Select(row => row.Id).Distinct().Count());
        Assert.All(first, row => Assert.Equal('7', row.Id.ToString("D")[14]));
        Assert.All(first.OfType<Station>(), row => Assert.StartsWith("[ÖRNEK]", row.Name));
        Assert.All(first.OfType<Animal>(), row => Assert.StartsWith("[ÖRNEK]", row.Name));
        Assert.All(first.OfType<AdoptionPost>(), row => Assert.StartsWith("[ÖRNEK]", row.Description));
        Assert.All(first.OfType<CarePlace>(), row =>
        {
            Assert.StartsWith("[ÖRNEK]", row.Name);
            Assert.True(row.IsSample);
            Assert.False(row.Verified);
            Assert.Null(row.Phone);
        });
        Assert.All(first.OfType<User>(), row =>
        {
            Assert.StartsWith("[ÖRNEK]", row.DisplayName);
            Assert.Null(row.PasswordHash);
            Assert.Null(row.Email);
            Assert.NotNull(row.DeactivatedAt);
        });
    }

    [Fact]
    public async Task SavingStampsBothTimestampsAndPreservesCreationTime()
    {
        await using var context = CreateContext(suppressWrites: true);
        var user = new User { DisplayName = "Deniz", Id = Guid.Empty };
        context.Add(user);
        await context.SaveChangesAsync(TestContext.Current.CancellationToken);
        Assert.NotEqual(Guid.Empty, user.Id);
        Assert.Equal(user.CreatedAt, user.UpdatedAt);
        var createdAt = user.CreatedAt;
        context.Entry(user).State = EntityState.Unchanged;
        user.DisplayName = "Ekin";
        user.CreatedAt = createdAt.AddDays(-1);
        context.SaveChanges();
        Assert.False(context.Entry(user).Property(row => row.CreatedAt).IsModified);
        Assert.True(user.UpdatedAt >= createdAt);
    }

    private sealed class SuppressWrites : SaveChangesInterceptor
    {
        public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
            => InterceptionResult<int>.SuppressWithResult(0);

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
            => ValueTask.FromResult(InterceptionResult<int>.SuppressWithResult(0));
    }
}
