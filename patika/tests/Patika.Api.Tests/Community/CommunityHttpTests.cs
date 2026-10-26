using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Patika.Api.Features.Animals;
using Patika.Api.Features.Stations;
using Patika.Api.Security.Authorization;
using Patika.Contracts.Community;
using Patika.Domain.Security;
using Patika.Infrastructure.Persistence;
using Xunit;

namespace Patika.Api.Tests.Community;

public sealed class CommunityHttpTests
{
    [Theory]
    [InlineData("/v1/stations?bbox=28,41,29,42")]
    [InlineData("/v1/animals?bbox=NaN,41,29,42")]
    [InlineData("/v1/stations?bbox=28.96,41,28.98,41.02&zoom=23")]
    [InlineData("/v1/animals/10000000-0000-0000-0000-000000000001/sightings?pageSize=501")]
    [InlineData("/v1/stations/10000000-0000-0000-0000-000000000001/feedings?page=0")]
    [InlineData("/v1/stations?bbox=28.96,41,28.98,41.02&page=0")]
    [InlineData("/v1/stations?bbox=28.96,41,28.98,41.02&pageSize=501")]
    [InlineData("/v1/animals?bbox=28.96,41,28.98,41.02&page=0")]
    [InlineData("/v1/animals?bbox=28.96,41,28.98,41.02&pageSize=501")]
    [InlineData("/v1/stations/10000000-0000-0000-0000-000000000001/feedings?pageSize=501")]
    [InlineData("/v1/animals/10000000-0000-0000-0000-000000000001/photos?page=0")]
    [InlineData("/v1/animals/10000000-0000-0000-0000-000000000001/photos?pageSize=501")]
    [InlineData("/v1/animals/10000000-0000-0000-0000-000000000001/sightings?page=0")]
    [InlineData("/v1/adoptions?page=0")]
    [InlineData("/v1/adoptions?pageSize=501")]
    [InlineData("/v1/care-places?page=0")]
    [InlineData("/v1/care-places?pageSize=501")]
    public async Task InvalidQueriesReturnValidationProblemsBeforeDatabaseAccess(string path)
    {
        await using var app = CreateApp();
        await app.StartAsync(TestContext.Current.CancellationToken);
        using var client = app.GetTestClient();
        using var response = await client.GetAsync(path, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    [Theory]
    [InlineData("POST", "/v1/stations")]
    [InlineData("PATCH", "/v1/stations/10000000-0000-0000-0000-000000000001")]
    [InlineData("POST", "/v1/stations/10000000-0000-0000-0000-000000000001/feedings")]
    [InlineData("POST", "/v1/stations/10000000-0000-0000-0000-000000000001/needs-refill")]
    [InlineData("POST", "/v1/animals")]
    [InlineData("PATCH", "/v1/animals/10000000-0000-0000-0000-000000000001")]
    [InlineData("POST", "/v1/animals/10000000-0000-0000-0000-000000000001/photos")]
    [InlineData("POST", "/v1/animals/10000000-0000-0000-0000-000000000001/sightings")]
    [InlineData("PUT", "/v1/animals/10000000-0000-0000-0000-000000000001/follow")]
    [InlineData("DELETE", "/v1/animals/10000000-0000-0000-0000-000000000001/follow")]
    public async Task GuestCannotMutateCommunityResources(string method, string path)
    {
        await using var app = CreateApp();
        await app.StartAsync(TestContext.Current.CancellationToken);
        using var client = app.GetTestClient();
        using var request = new HttpRequestMessage(new HttpMethod(method), path) { Content = JsonContent.Create(new { }) };
        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task EveryEndpointHasAPermissionGate()
    {
        await using var app = CreateApp();
        await app.StartAsync(TestContext.Current.CancellationToken);
        var endpoints = ((IEndpointRouteBuilder)app).DataSources.SelectMany(x => x.Endpoints).ToArray();
        Assert.Equal(28, endpoints.Length);
        foreach (var endpoint in endpoints)
        {
            var policy = endpoint.Metadata.GetOrderedMetadata<Microsoft.AspNetCore.Authorization.IAuthorizeData>();
            var permissions = endpoint.Metadata.GetOrderedMetadata<Microsoft.AspNetCore.Authorization.AuthorizationPolicy>()
                .SelectMany(x => x.Requirements).OfType<PermissionRequirement>().ToArray();
            Assert.True(policy.Count > 0 || permissions.Length > 0);
        }
    }

    internal static WebApplication CreateApp(string? connectionString = null)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Development" });
        builder.WebHost.UseTestServer();
        builder.AddPatikaApi();
        builder.Services.AddDbContext<PatikaDbContext>(options => options.UseNpgsql(
            connectionString ?? "Host=127.0.0.1;Port=1;Database=community;Timeout=1", pg => pg.UseNetTopologySuite()));
        var app = builder.Build();
        app.UsePatikaApi();
        var v1 = app.MapGroup("/v1");
        v1.MapStationEndpoints();
        v1.MapAnimalEndpoints();
        Patika.Api.Features.Adoptions.AdoptionEndpoints.MapAdoptionEndpoints(v1);
        Patika.Api.Features.CarePlaces.CarePlaceEndpoints.MapCarePlaceEndpoints(v1);
        return app;
    }
}
