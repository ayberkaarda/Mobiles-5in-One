using Microsoft.EntityFrameworkCore;
using Patika.Infrastructure.Persistence;
using Testcontainers.Minio;
using Testcontainers.PostgreSql;
using Xunit;

namespace Patika.Worker.Tests;

/// <summary>Throwaway PostGIS (random host port) with the EF migrations applied.</summary>
public sealed class WorkerPostgisFixture : IAsyncLifetime
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

    public async ValueTask DisposeAsync() => await container.DisposeAsync();

    public PatikaDbContext CreateContext() => new(new DbContextOptionsBuilder<PatikaDbContext>()
        .UseNpgsql(container.GetConnectionString(), postgres => postgres.UseNetTopologySuite())
        .Options);
}

public sealed class MinioFixture : IAsyncLifetime
{
    public const string Bucket = "patika-test";

    private readonly MinioContainer container = new MinioBuilder("pgsty/minio:RELEASE.2026-08-04T00-00-00Z").Build();

    public string Endpoint => container.GetConnectionString();

    public string AccessKey => container.GetAccessKey();

    public string SecretKey => container.GetSecretKey();

    public async ValueTask InitializeAsync()
    {
        await container.StartAsync();
        using var client = new Amazon.S3.AmazonS3Client(AccessKey, SecretKey, new Amazon.S3.AmazonS3Config
        {
            ServiceURL = Endpoint,
            ForcePathStyle = true,
            AuthenticationRegion = "us-east-1",
            UseHttp = true,
        });
        await client.PutBucketAsync(Bucket);
    }

    public async ValueTask DisposeAsync() => await container.DisposeAsync();
}
