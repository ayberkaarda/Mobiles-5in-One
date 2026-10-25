using Patika.Domain;
using Patika.Domain.Entities;
using Xunit;

namespace Patika.Domain.Tests;

public sealed class EntityTests
{
    [Fact]
    public void NewUsersHaveDistinctVersionSevenIds()
    {
        var first = new User { DisplayName = "Deniz" };
        var second = new User { DisplayName = "Ekin" };

        Assert.NotEqual(Guid.Empty, first.Id);
        Assert.NotEqual(first.Id, second.Id);
        Assert.Equal('7', first.Id.ToString("D")[14]);
        Assert.Equal(UserRole.User, first.Role);
    }

    [Theory]
    [InlineData(181, 0)]
    [InlineData(0, 91)]
    [InlineData(double.NaN, 0)]
    public void LocationsRejectInvalidCoordinates(double longitude, double latitude)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new GeoPoint(longitude, latitude));
    }

    [Fact]
    public void LocationPreservesCoordinateOrder()
    {
        var location = new GeoPoint(29.0, 41.0);

        Assert.Equal(29.0, location.Longitude);
        Assert.Equal(41.0, location.Latitude);
    }
}
