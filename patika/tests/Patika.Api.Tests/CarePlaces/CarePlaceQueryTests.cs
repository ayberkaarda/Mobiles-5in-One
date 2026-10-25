using Microsoft.EntityFrameworkCore;
using Patika.Api.Features.CarePlaces;
using Patika.Infrastructure.Persistence;
using Xunit;

namespace Patika.Api.Tests.CarePlaces;

public sealed class CarePlaceQueryTests
{
    [Fact]
    public void NearbyDistanceTranslatesToServerQuery()
    {
        using var db = new PatikaDbContext(new DbContextOptionsBuilder<PatikaDbContext>()
            .UseNpgsql("Host=localhost;Database=patika", options => options.UseNetTopologySuite()).Options);
        var sql = CarePlaceEndpoints.Nearby(db, 41, 29, 5000, null, null, 1, 20).ToQueryString();
        Assert.Contains("ST_Distance", sql);
        Assert.Contains("LIMIT", sql);
    }
}
