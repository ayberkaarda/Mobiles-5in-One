using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Patika.Worker.Jobs.Push;
using Xunit;

namespace Patika.Worker.Tests;

public sealed class CostGuardTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static PushCostGuard Guard(IPushCounterStore counters, int soft = 100, int hard = 250) =>
        new(counters, Options.Create(new PushSettings { CostGuard = new CostGuardSettings { DailyCap = soft, CriticalDailyCap = hard } }),
            new FixedClock(new DateTimeOffset(2026, 10, 25, 12, 0, 0, TimeSpan.Zero)));

    [Fact]
    public async Task NonCriticalSendsPauseAtTheSoftCapWhileCriticalContinueToTheHardCap()
    {
        var guard = Guard(new InMemoryPushCounters());

        Assert.Equal(80, await guard.ReserveAsync(80, critical: false, Ct));
        Assert.Equal(20, await guard.ReserveAsync(50, critical: false, Ct));
        Assert.Equal(0, await guard.ReserveAsync(1, critical: false, Ct));
        Assert.True((await guard.StatusAsync(Ct)).NonCriticalPaused);

        Assert.Equal(150, await guard.ReserveAsync(500, critical: true, Ct));
        Assert.Equal(0, await guard.ReserveAsync(1, critical: true, Ct));
        Assert.True((await guard.StatusAsync(Ct)).CriticalPaused);
    }

    [Fact]
    public async Task UnusedGrantsAreReleased()
    {
        var guard = Guard(new InMemoryPushCounters());
        Assert.Equal(100, await guard.ReserveAsync(100, critical: false, Ct));
        await guard.ReleaseAsync(40, Ct);
        Assert.Equal(60, (await guard.StatusAsync(Ct)).Sent);
        Assert.Equal(40, await guard.ReserveAsync(90, critical: false, Ct));
    }

    [Fact]
    public async Task CostGuardJobAlertsOncePerDayAboveTheCap()
    {
        var counters = new InMemoryPushCounters();
        var guard = Guard(counters);
        var notifier = new RecordingAlertNotifier();
        var job = new CostGuardJob(guard, notifier, new CostGuardAlertState());

        Assert.False((await job.RunOnceAsync(Ct)).NonCriticalPaused);
        Assert.Empty(notifier.Alerts);

        await guard.ReserveAsync(100, critical: false, Ct);
        Assert.True((await job.RunOnceAsync(Ct)).NonCriticalPaused);
        await job.RunOnceAsync(Ct);
        Assert.Single(notifier.Alerts);
        Assert.Equal(100, notifier.Alerts[0].Sent);
    }
}

public sealed class FcmSenderTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task SendsAnHttpV1MessageWithAMintedAccessTokenAndNoLocation()
    {
        var handler = new RecordingHandler();
        var sender = new FcmPushSender(new HttpClient(handler), Settings(), TimeProvider.System);
        var data = new Dictionary<string, string> { ["type"] = "urgent", ["urgentId"] = Guid.Empty.ToString("D") };

        var outcome = await sender.SendAsync(new PushMessage("device-token-1", "Acil", "Yakında", data, Critical: true), Ct);
        await sender.SendAsync(new PushMessage("device-token-2", "Acil", "Yakında", data, Critical: false), Ct);

        Assert.Equal(PushOutcome.Sent, outcome);
        Assert.Equal(1, handler.TokenRequests);
        var sends = handler.Sends;
        Assert.Equal(2, sends.Count);
        Assert.Equal("https://fcm.googleapis.com/v1/projects/patika-test/messages:send", sends[0].Uri);
        Assert.Equal("Bearer test-access-token", sends[0].Authorization);
        using var body = JsonDocument.Parse(sends[0].Body);
        var message = body.RootElement.GetProperty("message");
        Assert.Equal("device-token-1", message.GetProperty("token").GetString());
        Assert.Equal("HIGH", message.GetProperty("android").GetProperty("priority").GetString());
        Assert.DoesNotContain("lat", sends[0].Body, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("\"NORMAL\"", sends[1].Body, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(HttpStatusCode.NotFound, "{}", PushOutcome.InvalidToken)]
    [InlineData(HttpStatusCode.BadRequest, """{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}""", PushOutcome.InvalidToken)]
    [InlineData(HttpStatusCode.TooManyRequests, "{}", PushOutcome.Retryable)]
    [InlineData(HttpStatusCode.ServiceUnavailable, "{}", PushOutcome.Retryable)]
    [InlineData(HttpStatusCode.BadRequest, """{"error":{"status":"INVALID_ARGUMENT"}}""", PushOutcome.Failed)]
    public void ProviderErrorsAreClassified(HttpStatusCode status, string body, PushOutcome expected) =>
        Assert.Equal(expected, FcmPushSender.Classify(status, body));

    [Fact]
    public void TheMessageIsDataOnlyWithIdsAndNoText()
    {
        var data = new Dictionary<string, string> { ["type"] = "urgent", ["urgentId"] = Guid.Empty.ToString("D"), ["category"] = "injured" };
        var json = JsonSerializer.Serialize(FcmPushSender.Body(new PushMessage("tok", "Acil", "Yakında", data, Critical: true)));

        using var doc = JsonDocument.Parse(json);
        var message = doc.RootElement.GetProperty("message");
        Assert.False(message.TryGetProperty("notification", out _));
        Assert.False(message.GetProperty("android").TryGetProperty("notification", out _));
        Assert.Equal("HIGH", message.GetProperty("android").GetProperty("priority").GetString());
        var sent = message.GetProperty("data").EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetString());
        Assert.Equal(2, sent.Count);
        Assert.Equal("urgent_nearby", sent["type"]);
        Assert.Equal(Guid.Empty.ToString("D"), sent["urgentId"]);
        Assert.DoesNotContain("Acil", json, StringComparison.Ordinal);
        Assert.DoesNotContain("Yakında", json, StringComparison.Ordinal);
        Assert.DoesNotContain("injured", json, StringComparison.Ordinal);
    }

    private static FcmSettings Settings()
    {
        // A throwaway key created per run; nothing secret is stored in the repository.
        using var rsa = RSA.Create(2048);
        var json = JsonSerializer.Serialize(new Dictionary<string, string>
        {
            ["client_email"] = "push@patika-test.iam.example",
            ["private_key"] = rsa.ExportPkcs8PrivateKeyPem(),
            ["token_uri"] = "https://oauth.example.test/token",
        });
        return new FcmSettings { ProjectId = "patika-test", ServiceAccountJson = json };
    }

    private sealed class RecordingHandler : HttpMessageHandler
    {
        public int TokenRequests;

        public List<(string Uri, string? Authorization, string Body)> Sends { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
            if (request.RequestUri!.Host == "oauth.example.test")
            {
                TokenRequests++;
                Assert.Contains("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer", body, StringComparison.Ordinal);
                Assert.Equal(3, body.Split("assertion=")[1].Split('.').Length);
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("""{"access_token":"test-access-token","expires_in":3600}""", Encoding.UTF8, "application/json"),
                };
            }

            Sends.Add((request.RequestUri.AbsoluteUri, request.Headers.Authorization?.ToString(), body));
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{}") };
        }
    }
}

public sealed class UrgentFanoutTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task FanoutNeverExceeds500DevicesAndSkipsTheAuthor()
    {
        var author = Guid.CreateVersion7();
        var post = new FanoutPost(Guid.CreateVersion7(), author, 41.0082, 28.9784, "Injured");
        var store = new ScriptedFanoutStore(post,
            [.. Enumerable.Range(0, 700).Select(i => new FanoutRecipient(Guid.CreateVersion7(), Guid.CreateVersion7(), $"token-{i}")),
                new FanoutRecipient(Guid.CreateVersion7(), author, "author-token")]);
        var sender = new FakePushSender();
        sender.Invalid.Add("token-3");
        var fanout = Fanout(store, sender, new InMemoryPushCounters());

        var summary = Assert.Single(await fanout.RunOnceAsync(Ct));

        Assert.Equal(500, summary.Recipients);
        Assert.Equal(499, sender.Sent.Count);
        Assert.DoesNotContain(sender.Sent, m => m.Token == "author-token");
        Assert.All(sender.Sent, m => Assert.True(m.Critical));
        Assert.All(sender.Sent, m => Assert.Equal(["category", "type", "urgentId"], m.Data.Keys.Order()));
        Assert.Equal(499, store.Notified[post.Id]);
        Assert.Single(store.Removed);
        Assert.Equal(500, store.RequestedCap);
        Assert.Equal(2000, store.RequestedRadius);
    }

    [Fact]
    public async Task CostGuardLimitsTheFanout()
    {
        var post = new FanoutPost(Guid.CreateVersion7(), Guid.CreateVersion7(), 41.0, 29.0, "Sick");
        var store = new ScriptedFanoutStore(post,
            [.. Enumerable.Range(0, 50).Select(i => new FanoutRecipient(Guid.CreateVersion7(), Guid.CreateVersion7(), $"t-{i}"))]);
        var sender = new FakePushSender();
        var counters = new InMemoryPushCounters();
        var fanout = Fanout(store, sender, counters, criticalCap: 30);

        var summary = Assert.Single(await fanout.RunOnceAsync(Ct));

        Assert.Equal(30, summary.Granted);
        Assert.Equal(30, sender.Sent.Count);
    }

    private static UrgentFanout Fanout(IUrgentFanoutStore store, IPushSender sender, IPushCounterStore counters, int criticalCap = 20_000)
    {
        var settings = Options.Create(new PushSettings
        {
            MaxDevicesPerPost = 10_000,
            MaxRadiusMeters = 50_000,
            CostGuard = new CostGuardSettings { DailyCap = 10, CriticalDailyCap = criticalCap },
        });
        var clock = new FixedClock(DateTimeOffset.UtcNow);
        return new UrgentFanout(store, sender, new PushCostGuard(counters, settings, clock), settings, clock, NullLogger<UrgentFanout>.Instance);
    }

    /// <summary>Returns more candidates than allowed, to prove the service caps independently of the query.</summary>
    private sealed class ScriptedFanoutStore(FanoutPost post, IReadOnlyList<FanoutRecipient> recipients) : IUrgentFanoutStore
    {
        private bool claimed;

        public Dictionary<Guid, int> Notified { get; } = [];

        public List<Guid> Removed { get; } = [];

        public int RequestedCap { get; private set; }

        public int RequestedRadius { get; private set; }

        public Task<IReadOnlyList<FanoutPost>> ClaimAsync(DateTimeOffset now, DateTimeOffset createdSince, int batch, CancellationToken cancellationToken)
        {
            IReadOnlyList<FanoutPost> result = claimed ? [] : [post];
            claimed = true;
            return Task.FromResult(result);
        }

        public Task<IReadOnlyList<FanoutRecipient>> RecipientsAsync(
            FanoutPost fanoutPost, int maxRadiusMeters, int cap, DateTimeOffset seenSince, CancellationToken cancellationToken)
        {
            RequestedCap = cap;
            RequestedRadius = maxRadiusMeters;
            return Task.FromResult(recipients);
        }

        public Task CompleteAsync(Guid postId, int notified, CancellationToken cancellationToken)
        {
            Notified[postId] = notified;
            return Task.CompletedTask;
        }

        public Task RemoveDevicesAsync(IReadOnlyCollection<Guid> deviceIds, CancellationToken cancellationToken)
        {
            Removed.AddRange(deviceIds);
            return Task.CompletedTask;
        }
    }
}
