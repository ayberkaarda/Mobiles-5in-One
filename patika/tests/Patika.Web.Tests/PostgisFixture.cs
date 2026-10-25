using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Patika.Infrastructure.Persistence;
using Testcontainers.PostgreSql;
using Xunit;

namespace Patika.Web.Tests;

public sealed class PostgisFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer container = new PostgreSqlBuilder("postgis/postgis:17-3.5")
        .WithDatabase("patika").WithUsername("patika").WithPassword("patika-test").Build();
    public string ConnectionString => container.GetConnectionString();
    public static readonly Guid UserId = Guid.Parse("10000000-0000-0000-0000-000000000001");
    public static readonly Guid StationId = Guid.Parse("20000000-0000-0000-0000-000000000001");
    public static readonly Guid AnimalId = Guid.Parse("30000000-0000-0000-0000-000000000001");
    public static readonly Guid PostId = Guid.Parse("40000000-0000-0000-0000-000000000001");
    public static readonly DateTimeOffset Now = new(2026, 10, 25, 12, 0, 0, TimeSpan.Zero);

    public async ValueTask InitializeAsync()
    {
        await container.StartAsync();
        await using var db = CreateContext();
        await db.GetService<IMigrator>().MigrateAsync("20261025170707_Phase3Api");
        await db.Database.ExecuteSqlAsync($"""
            INSERT INTO users (id, display_name, email, role, urgent_opt_in, urgent_radius_m, session_version, created_at, updated_at)
            VALUES ('10000000-0000-0000-0000-000000000001', 'Private Person', 'private@example.org', 'User', false, 2000, 0, '2026-10-20T00:00:00Z', '2026-10-20T00:00:00Z');
            INSERT INTO stations (id, location, kind, species, photo_key, created_by, status, feedings_count, district, created_at, updated_at)
            VALUES ('20000000-0000-0000-0000-000000000001', ST_SetSRID(ST_MakePoint(29.123456,41.123456),4326), 'Both', 'Cat',
                'station/20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Active', 0, ' KADIKÖY! ', '2026-10-20T00:00:00Z', '2026-10-20T00:00:00Z');
            INSERT INTO animals (id, location, species, name, sex, sterilized, vaccinated, ear_tagged, status, created_by, district, created_at, updated_at)
            VALUES ('30000000-0000-0000-0000-000000000001', ST_SetSRID(ST_MakePoint(29,41),4326), 'Cat', 'Pamuk', 'Female', true, true, false, 'Healthy',
                '10000000-0000-0000-0000-000000000001', 'Kadıköy', '2026-10-20T00:00:00Z', '2026-10-20T00:00:00Z');
            INSERT INTO adoption_posts (id, animal_id, description, requirements, district, state, closes_at, created_by, created_at, updated_at)
            VALUES ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Description', 'Requirements', 'Kadıköy', 'Published',
                '2026-11-20T00:00:00Z', '10000000-0000-0000-0000-000000000001', '2026-10-20T00:00:00Z', '2026-10-20T00:00:00Z');
            INSERT INTO care_places (id, name, kind, location, address, open24h, verified, is_sample, created_at, updated_at)
            SELECT ('50000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid, 'Klinik', 'Vet', ST_SetSRID(ST_MakePoint(29,41),4326), 'Address', true, true, false, '2026-10-20T00:00:00Z', '2026-10-20T00:00:00Z'
            FROM generate_series(1,2) AS i;
            """);
        await db.Database.MigrateAsync();
        await db.Database.ExecuteSqlAsync($"""
            INSERT INTO feedings (id, station_id, at, created_at, updated_at) VALUES
                ('61000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '2026-10-18T20:59:59Z', '2026-10-18T20:59:59Z', '2026-10-18T20:59:59Z'),
                ('61000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '2026-10-18T21:00:00Z', '2026-10-18T21:00:00Z', '2026-10-18T21:00:00Z');
            INSERT INTO adoption_posts (id, animal_id, description, requirements, district, state, closes_at, created_by, created_at, updated_at, slug, closed_reason, adopted_at)
            VALUES ('62000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Closed', 'Home', 'Unknown', 'Closed',
                '2026-10-14T00:00:00Z', '10000000-0000-0000-0000-000000000001', '2026-10-01T00:00:00Z', '2026-10-14T00:00:00Z', 'closed-adoption', 'Adopted', '2026-10-14T00:00:00Z');
            INSERT INTO urgent_posts (id, location, category, description, photo_key, state, created_by, notified_count, created_at, updated_at, hidden_at)
            SELECT ('63000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid, ST_SetSRID(ST_MakePoint(29,41),4326), 'Injured', 'Handled', 'urgent/test', 'Handled',
                '10000000-0000-0000-0000-000000000001', 0, '2026-10-14T00:00:00Z', '2026-10-14T00:00:00Z', CASE WHEN i = 2 THEN '2026-10-14T00:00:00Z'::timestamptz ELSE NULL END
            FROM generate_series(1,2) AS i;
            INSERT INTO stations (id, location, kind, species, photo_key, created_by, status, feedings_count, created_at, updated_at)
            VALUES ('64000000-0000-0000-0000-000000000001', ST_SetSRID(ST_MakePoint(29,41),4326), 'Food', 'Cat', 'station/test',
                '10000000-0000-0000-0000-000000000001', 'Active', 0, '2026-10-14T00:00:00Z', '2026-10-14T00:00:00Z');
            """);
    }
    public PatikaDbContext CreateContext() => new(new DbContextOptionsBuilder<PatikaDbContext>()
        .UseNpgsql(ConnectionString, pg => pg.UseNetTopologySuite()).Options);
    public async ValueTask DisposeAsync() => await container.DisposeAsync();
}

public sealed class FixedClock : TimeProvider
{
    public override DateTimeOffset GetUtcNow() => PostgisFixture.Now;
}
