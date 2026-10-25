using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Patika.Api.Features.Auth;
using Patika.Api.Features.Reports;
using Patika.Api.Idempotency;
using Patika.Api.Tests.Infrastructure;
using Patika.Contracts.Community;
using Patika.Contracts.Geo;
using Xunit;

namespace Patika.Api.Tests.Idempotency;

/// <summary>
/// The real application (Program, real routes, real filters, migrated PostgreSQL, real accounts): a create
/// request repeated with the same Idempotency-Key leaves exactly one row and replays the first answer.
/// </summary>
public sealed class RealRouteIdempotencyTests : IClassFixture<PostgisFixture>, IAsyncLifetime
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static readonly CoordinateDto Spot = new(41.0082, 28.9784);

    private readonly PostgisFixture database;
    private readonly PatikaApiFactory factory = new();
    private HttpClient client = null!;
    private Guid userId;

    public RealRouteIdempotencyTests(PostgisFixture database)
    {
        this.database = database;
        factory.Settings["ConnectionStrings:Patika"] = database.ConnectionString;
        factory.ExtraServices = services =>
        {
            services.RemoveAll<IAuthStore>();
            services.AddScoped<IAuthStore, EfAuthStore>();
        };
    }

    public async ValueTask InitializeAsync()
    {
        client = factory.CreateApiClient();
        var email = ApiTestClient.NewEmail("idem");
        var tokens = await client.RegisterAsync(factory, email);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.AccessToken);
        await using var db = database.CreateContext();
        userId = await db.Users.Where(u => u.Email == email).Select(u => u.Id).SingleAsync(Ct);
    }

    public async ValueTask DisposeAsync()
    {
        client.Dispose();
        await factory.DisposeAsync();
    }

    private sealed record Twice(HttpResponseMessage First, HttpResponseMessage Second, string FirstBody, string SecondBody);

    private async Task<Twice> TwiceAsync(string path, object body)
    {
        var key = Guid.NewGuid();
        var first = await PostAsync(path, body, key);
        var firstBody = await first.Content.ReadAsStringAsync(Ct);
        var second = await PostAsync(path, body, key);
        var secondBody = await second.Content.ReadAsStringAsync(Ct);
        return new Twice(first, second, firstBody, secondBody);
    }

    private async Task<HttpResponseMessage> PostAsync(string path, object body, Guid key)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) };
        request.Headers.Add(IdempotencyExtensions.HeaderName, key.ToString());
        return await client.SendAsync(request, Ct);
    }

    private static void AssertReplayed(Twice r)
    {
        Assert.Equal(HttpStatusCode.Created, r.First.StatusCode);
        Assert.Equal(HttpStatusCode.Created, r.Second.StatusCode);
        Assert.Equal(r.FirstBody, r.SecondBody);
        Assert.False(r.First.Headers.Contains(IdempotencyExtensions.ReplayedHeaderName));
        Assert.Equal("true", r.Second.Headers.GetValues(IdempotencyExtensions.ReplayedHeaderName).Single());
    }

    private async Task<Guid> CreateStationAsync()
    {
        using var response = await client.PostAsJsonAsync("/v1/stations",
            new StationRequest(Spot, "Food", "Cat", "station/foto.jpg"), Ct);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<StationResponse>(Ct))!.Id;
    }

    [Fact]
    public async Task StationCreateReplaysToOneRow()
    {
        var name = "Kadikoy " + Guid.NewGuid().ToString("N");
        var result = await TwiceAsync("/v1/stations", new StationRequest(Spot, "Food", "Cat", "station/foto.jpg", name));
        AssertReplayed(result);
        await using var db = database.CreateContext();
        Assert.Equal(1, await db.Stations.CountAsync(s => s.Name == name, Ct));
    }

    [Fact]
    public async Task FeedingCreateReplaysToOneRow()
    {
        var station = await CreateStationAsync();
        var note = "Kuru mama " + Guid.NewGuid().ToString("N");
        var result = await TwiceAsync($"/v1/stations/{station}/feedings", new FeedingRequest(null, note));
        AssertReplayed(result);
        await using var db = database.CreateContext();
        Assert.Equal(1, await db.Feedings.CountAsync(f => f.StationId == station && f.Note == note, Ct));
    }

    [Fact]
    public async Task AnimalAndSightingCreateReplayToOneRowEach()
    {
        var name = "Karabas" + Guid.NewGuid().ToString("N");
        var animals = await TwiceAsync("/v1/animals", new AnimalRequest(Spot, "Dog", "Unknown", "Healthy", Name: name));
        AssertReplayed(animals);
        await using var db = database.CreateContext();
        var animal = await db.Animals.Where(x => x.Name == name).Select(x => x.Id).SingleAsync(Ct);

        var note = "Gordum " + Guid.NewGuid().ToString("N");
        var sightings = await TwiceAsync($"/v1/animals/{animal}/sightings", new SightingRequest(note));
        AssertReplayed(sightings);
        Assert.Equal(1, await db.Sightings.CountAsync(s => s.AnimalId == animal && s.Note == note, Ct));
    }

    [Fact]
    public async Task ReportCreateReplaysToOneRow()
    {
        var station = await CreateStationAsync();
        var reason = "Uygunsuz " + Guid.NewGuid().ToString("N");
        var result = await TwiceAsync("/v1/reports", new CreateReport("station", station, reason));
        AssertReplayed(result);
        await using var db = database.CreateContext();
        Assert.Equal(1, await db.Reports.CountAsync(r => r.TargetId == station && r.Reason == reason, Ct));
    }

    [Fact]
    public async Task TheSameKeyWithAnotherBodyIsRejected()
    {
        var key = Guid.NewGuid();
        var station = await CreateStationAsync();
        using var ok = await PostAsync("/v1/reports", new CreateReport("station", station, "Bir"), key);
        using var other = await PostAsync("/v1/reports", new CreateReport("station", station, "Iki"), key);
        Assert.Equal(HttpStatusCode.Created, ok.StatusCode);
        Assert.Equal((HttpStatusCode)422, other.StatusCode);
    }

    [Fact]
    public async Task TokenProducingRoutesIgnoreTheHeader()
    {
        var email = ApiTestClient.NewEmail("auth");
        var before = await KeyCountAsync();
        using var first = await PostAsync("/v1/auth/login", new Patika.Contracts.Auth.LoginRequest(email, ApiTestClient.StrongPassword), Guid.NewGuid());
        using var second = await PostAsync("/v1/auth/login", new Patika.Contracts.Auth.LoginRequest(email, ApiTestClient.StrongPassword), Guid.NewGuid());
        Assert.False(first.Headers.Contains(IdempotencyExtensions.ReplayedHeaderName));
        Assert.False(second.Headers.Contains(IdempotencyExtensions.ReplayedHeaderName));
        Assert.Equal(before, await KeyCountAsync());
    }

    private async Task<int> KeyCountAsync()
    {
        await using var db = database.CreateContext();
        return await db.IdempotencyKeys.CountAsync(k => k.UserId == userId, Ct);
    }
}
