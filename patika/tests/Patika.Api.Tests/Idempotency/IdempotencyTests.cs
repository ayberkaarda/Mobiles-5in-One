using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Patika.Api.Idempotency;
using Patika.Api.Security.Tokens;
using Patika.Api.Tests.Infrastructure;
using Patika.Domain.Entities;
using Patika.Infrastructure;
using Patika.Infrastructure.Persistence;
using Testcontainers.PostgreSql;
using Xunit;

namespace Patika.Api.Tests.Idempotency;

/// <summary>PostGIS (random host port) with the full model, and a small host whose create endpoint is idempotent.</summary>
public sealed class IdempotencyFixture : IAsyncLifetime
{
    public const string UserHeader = "X-Test-User";

    private readonly PostgreSqlContainer container = new PostgreSqlBuilder("postgis/postgis:17-3.5")
        .WithDatabase("patika")
        .WithUsername("patika")
        .WithPassword("patika-test")
        .Build();

    private WebApplication app = null!;

    public HttpClient Client { get; private set; } = null!;

    /// <summary>Number of handler executions, to prove a replay never runs the handler again.</summary>
    public int Executions;

    public async ValueTask InitializeAsync()
    {
        await container.StartAsync();
        await using (var db = CreateContext())
        {
            await db.Database.EnsureCreatedAsync();
        }

        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseTestServer();
        builder.Services.AddPatikaInfrastructure(container.GetConnectionString());
        builder.Services.AddSingleton(TimeProvider.System);
        builder.Services.AddProblemDetails();
        app = builder.Build();
        app.Use(async (context, next) =>
        {
            if (Guid.TryParse(context.Request.Headers[UserHeader], out var userId))
            {
                context.User = new ClaimsPrincipal(new ClaimsIdentity(
                    [new Claim(PatikaClaims.Subject, userId.ToString()), new Claim(PatikaClaims.Role, "User")], "Test"));
            }

            await next(context);
        });

        var reports = app.MapGroup("/v1/reports").WithIdempotency();
        reports.MapPost("", async (TestReportRequest body, HttpContext http, PatikaDbContext db, CancellationToken ct) =>
        {
            Interlocked.Increment(ref Executions);
            if (body.Reason == "reddet")
            {
                return Results.Problem(statusCode: StatusCodes.Status409Conflict, title: "Rejected.");
            }

            // Slow enough that concurrent replays really overlap with the original.
            await Task.Delay(TimeSpan.FromMilliseconds(250), ct);
            var reporter = Guid.Parse(http.Request.Headers[UserHeader]!);
            var report = new Report { TargetType = "station", TargetId = body.TargetId, ReporterId = reporter, Reason = body.Reason };
            db.Reports.Add(report);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/v1/reports/{report.Id}", new TestReportResponse(report.Id, report.Reason));
        });
        reports.MapGet("", () => Results.Ok("liste"));
        await app.StartAsync();
        Client = app.GetTestClient();
    }

    public async ValueTask DisposeAsync()
    {
        await app.DisposeAsync();
        await container.DisposeAsync();
    }

    public PatikaDbContext CreateContext() => new(new DbContextOptionsBuilder<PatikaDbContext>()
        .UseNpgsql(container.GetConnectionString(), postgres => postgres.UseNetTopologySuite())
        .Options);

    public async Task<Guid> CreateUserAsync()
    {
        await using var db = CreateContext();
        var user = new User { DisplayName = "Gönüllü" };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user.Id;
    }
}

public sealed record TestReportRequest(Guid TargetId, string Reason);

public sealed record TestReportResponse(Guid Id, string Reason);

public sealed class IdempotencyTests(IdempotencyFixture fixture) : IClassFixture<IdempotencyFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task ReplayReturnsTheOriginalResponseAndCreatesNothing()
    {
        var user = await fixture.CreateUserAsync();
        var key = Guid.NewGuid();
        var body = new TestReportRequest(Guid.NewGuid(), "Kırık mama kabı");

        using var first = await PostAsync(user, key, body);
        var firstBody = await first.Content.ReadAsStringAsync(Ct);
        using var second = await PostAsync(user, key, body);
        var secondBody = await second.Content.ReadAsStringAsync(Ct);

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.Created, second.StatusCode);
        Assert.Equal(firstBody, secondBody);
        Assert.Equal(first.Headers.Location, second.Headers.Location);
        Assert.Equal(first.Content.Headers.ContentType, second.Content.Headers.ContentType);
        Assert.False(first.Headers.Contains(IdempotencyExtensions.ReplayedHeaderName));
        Assert.Equal("true", second.Headers.GetValues(IdempotencyExtensions.ReplayedHeaderName).Single());
        Assert.Equal(1, await ReportCountAsync(user));
        Assert.Equal(1, await KeyCountAsync(user));
    }

    [Fact]
    public async Task TenConcurrentReplaysCreateOneRowAndShareOneResponse()
    {
        var user = await fixture.CreateUserAsync();
        var key = Guid.NewGuid();
        var body = new TestReportRequest(Guid.NewGuid(), "Su kabı devrilmiş");
        var before = fixture.Executions;

        var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var requests = Enumerable.Range(0, 10).Select(_ => Task.Run(async () =>
        {
            await start.Task;
            using var response = await PostAsync(user, key, body);
            return (response.StatusCode, Body: await response.Content.ReadAsStringAsync(Ct));
        }, Ct)).ToArray();
        start.SetResult();
        var results = await Task.WhenAll(requests);

        Assert.All(results, r => Assert.Equal(HttpStatusCode.Created, r.StatusCode));
        Assert.Single(results.Select(r => r.Body).Distinct());
        Assert.Equal(1, await ReportCountAsync(user));
        Assert.Equal(1, await KeyCountAsync(user));
        Assert.Equal(1, fixture.Executions - before);
    }

    [Fact]
    public async Task SameKeyWithADifferentBodyIs422()
    {
        var user = await fixture.CreateUserAsync();
        var key = Guid.NewGuid();
        var target = Guid.NewGuid();

        using var first = await PostAsync(user, key, new TestReportRequest(target, "Birinci"));
        using var changed = await PostAsync(user, key, new TestReportRequest(target, "İkinci"));

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, changed.StatusCode);
        Assert.Equal(IdempotencyErrorCodes.Mismatch, (await changed.ReadJsonAsync()).GetProperty("code").GetString());
        Assert.Equal(1, await ReportCountAsync(user));
    }

    [Fact]
    public async Task KeysAreScopedPerUser()
    {
        var alice = await fixture.CreateUserAsync();
        var bob = await fixture.CreateUserAsync();
        var key = Guid.NewGuid();
        var body = new TestReportRequest(Guid.NewGuid(), "Aynı anahtar");

        using var fromAlice = await PostAsync(alice, key, body);
        using var fromBob = await PostAsync(bob, key, body);

        Assert.Equal(HttpStatusCode.Created, fromAlice.StatusCode);
        Assert.Equal(HttpStatusCode.Created, fromBob.StatusCode);
        Assert.False(fromBob.Headers.Contains(IdempotencyExtensions.ReplayedHeaderName));
        Assert.NotEqual(fromAlice.Headers.Location, fromBob.Headers.Location);
        Assert.Equal(1, await ReportCountAsync(alice));
        Assert.Equal(1, await ReportCountAsync(bob));
    }

    [Fact]
    public async Task FailedOutcomesAreNotKeptSoTheKeyCanBeRetried()
    {
        var user = await fixture.CreateUserAsync();
        var key = Guid.NewGuid();
        var target = Guid.NewGuid();

        using var rejected = await PostAsync(user, key, new TestReportRequest(target, "reddet"));
        Assert.Equal(HttpStatusCode.Conflict, rejected.StatusCode);
        Assert.Equal(0, await KeyCountAsync(user));

        using var retried = await PostAsync(user, key, new TestReportRequest(target, "Düzeltilmiş"));
        Assert.Equal(HttpStatusCode.Created, retried.StatusCode);
        Assert.Equal(1, await KeyCountAsync(user));
    }

    [Fact]
    public async Task KeysOlderThan24HoursStartOver()
    {
        var user = await fixture.CreateUserAsync();
        var key = Guid.NewGuid();
        var body = new TestReportRequest(Guid.NewGuid(), "Dün");
        using (var first = await PostAsync(user, key, body))
        {
            Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        }

        await using (var db = fixture.CreateContext())
        {
            var aged = DateTimeOffset.UtcNow.AddHours(-25);
            await db.Database.ExecuteSqlAsync($"UPDATE idempotency_keys SET created_at = {aged} WHERE user_id = {user}", Ct);
        }

        using var again = await PostAsync(user, key, body);
        Assert.Equal(HttpStatusCode.Created, again.StatusCode);
        Assert.False(again.Headers.Contains(IdempotencyExtensions.ReplayedHeaderName));
        Assert.Equal(2, await ReportCountAsync(user));
        Assert.Equal(1, await KeyCountAsync(user));
    }

    [Theory]
    [InlineData("anahtar")]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    [InlineData("{5d0f6c7e-6a1f-4c55-9b7e-0f6c1c3c9d11}")]
    public async Task MalformedKeysAreRejected(string header)
    {
        var user = await fixture.CreateUserAsync();
        using var request = Request(user, new TestReportRequest(Guid.NewGuid(), "Bozuk"));
        request.Headers.TryAddWithoutValidation(IdempotencyExtensions.HeaderName, header);

        using var response = await fixture.Client.SendAsync(request, Ct);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(IdempotencyErrorCodes.InvalidKey, (await response.ReadJsonAsync()).GetProperty("code").GetString());
        Assert.Equal(0, await ReportCountAsync(user));
    }

    [Fact]
    public async Task WithoutAHeaderNothingIsStoredAndOtherMethodsPassThrough()
    {
        var user = await fixture.CreateUserAsync();
        var body = new TestReportRequest(Guid.NewGuid(), "Başlıksız");
        using (var plain = Request(user, body))
        {
            using var response = await fixture.Client.SendAsync(plain, Ct);
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        }

        using (var plain = Request(user, body))
        {
            using var response = await fixture.Client.SendAsync(plain, Ct);
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        }

        using var get = new HttpRequestMessage(HttpMethod.Get, "/v1/reports");
        get.Headers.Add(IdempotencyExtensions.HeaderName, "anahtar");
        using var listed = await fixture.Client.SendAsync(get, Ct);
        Assert.Equal(HttpStatusCode.OK, listed.StatusCode);
        Assert.Equal(2, await ReportCountAsync(user));
        Assert.Equal(0, await KeyCountAsync(user));
    }

    private Task<HttpResponseMessage> PostAsync(Guid user, Guid key, TestReportRequest body)
    {
        var request = Request(user, body);
        request.Headers.Add(IdempotencyExtensions.HeaderName, key.ToString());
        return SendAndDisposeAsync(request);
    }

    private async Task<HttpResponseMessage> SendAndDisposeAsync(HttpRequestMessage request)
    {
        using (request)
        {
            return await fixture.Client.SendAsync(request, Ct);
        }
    }

    private static HttpRequestMessage Request(Guid user, TestReportRequest body)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/v1/reports") { Content = JsonContent.Create(body) };
        request.Headers.Add(IdempotencyFixture.UserHeader, user.ToString());
        return request;
    }

    private async Task<int> ReportCountAsync(Guid user)
    {
        await using var db = fixture.CreateContext();
        return await db.Reports.CountAsync(r => r.ReporterId == user, Ct);
    }

    private async Task<int> KeyCountAsync(Guid user)
    {
        await using var db = fixture.CreateContext();
        return await db.Set<Patika.Infrastructure.Persistence.Configurations.IdempotencyKey>().CountAsync(k => k.UserId == user, Ct);
    }
}
