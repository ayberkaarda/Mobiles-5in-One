using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.TestHost;
using Patika.Contracts.Community;
using Patika.Domain;
using Patika.Domain.Entities;
using Xunit;

namespace Patika.Api.Tests.Community;

public sealed class PagingHttpTests
{
    [Theory]
    [InlineData("stations", 100)]
    [InlineData("animals", 100)]
    [InlineData("feedings", 10)]
    [InlineData("photos", 10)]
    [InlineData("sightings", 10)]
    [InlineData("adoptions", 20)]
    [InlineData("care-places", 20)]
    public async Task OmittedPagingReturnsOk(string resource, int pageSize)
    {
        var ct = TestContext.Current.CancellationToken;
        await using var database = new PostgisFixture();
        await database.InitializeAsync();
        var user = new User { DisplayName = "Deniz" };
        var station = new Station { CreatedBy = user.Id, Location = new GeoPoint(28.97, 41.01), PhotoKey = "station/a.jpg" };
        var animal = new Animal { CreatedBy = user.Id, Location = new GeoPoint(28.97, 41.01) };
        await using (var db = database.CreateContext())
        {
            db.AddRange(user, station, animal);
            await db.SaveChangesAsync(ct);
        }
        await using var app = CommunityHttpTests.CreateApp(database.ConnectionString);
        await app.StartAsync(ct);
        using var client = app.GetTestClient();
        var path = resource switch
        {
            "stations" or "animals" => $"/v1/{resource}?bbox=28.96,41,28.98,41.02",
            "feedings" => $"/v1/stations/{station.Id}/feedings",
            "photos" or "sightings" => $"/v1/animals/{animal.Id}/{resource}",
            _ => $"/v1/{resource}"
        };
        using var response = await client.GetAsync(path, ct);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        if (resource is not ("adoptions" or "care-places"))
        {
            var body = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>(ct);
            Assert.Equal(1, body.GetProperty("page").GetInt32());
            Assert.Equal(pageSize, body.GetProperty("pageSize").GetInt32());
        }
    }
}
