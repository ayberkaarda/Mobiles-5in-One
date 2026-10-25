using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Patika.Infrastructure.Persistence;

namespace Patika.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddPatikaInfrastructure(
        this IServiceCollection services, string? connectionString)
    {
        services.AddDbContext<PatikaDbContext>(options =>
            options.UseNpgsql(connectionString, postgres => postgres.UseNetTopologySuite()));

        return services;
    }
}
