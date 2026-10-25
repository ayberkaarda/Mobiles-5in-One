using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Patika.Infrastructure.Persistence;

public sealed class PatikaDbContextFactory : IDesignTimeDbContextFactory<PatikaDbContext>
{
    public PatikaDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("PATIKA_DB");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("PATIKA_DB must contain the PostgreSQL connection string.");
        }

        var options = new DbContextOptionsBuilder<PatikaDbContext>()
            .UseNpgsql(connectionString, postgres => postgres.UseNetTopologySuite())
            .Options;
        return new PatikaDbContext(options);
    }
}
