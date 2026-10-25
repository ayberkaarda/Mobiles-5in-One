using Microsoft.EntityFrameworkCore;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;
using Testcontainers.PostgreSql;
using Xunit;

namespace Patika.Api.Tests.Urgent;

/// <summary>
/// Throwaway PostGIS (random host port) with the EF migrations applied.
/// </summary>
public sealed class FeaturePostgisFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer container = new PostgreSqlBuilder("postgis/postgis:17-3.5")
        .WithDatabase("patika")
        .WithUsername("patika")
        .WithPassword("patika-test")
        .Build();

    public async ValueTask InitializeAsync()
    {
        await container.StartAsync();
        await using (var db = CreateContext())
        {
            await db.Database.MigrateAsync();
        }
    }

    public string ConnectionString => container.GetConnectionString();

    public async ValueTask DisposeAsync() => await container.DisposeAsync();

    public PatikaDbContext CreateContext() => new(new DbContextOptionsBuilder<PatikaDbContext>()
        .UseNpgsql(container.GetConnectionString(), postgres => postgres.UseNetTopologySuite())
        .Options);

    public async Task<Guid> CreateUserAsync(CancellationToken ct)
    {
        await using var db = CreateContext();
        var user = new User { DisplayName = "Gönüllü" };
        db.Users.Add(user);
        await db.SaveChangesAsync(ct);
        return user.Id;
    }
}
