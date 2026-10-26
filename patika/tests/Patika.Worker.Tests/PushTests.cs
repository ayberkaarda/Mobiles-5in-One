using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Patika.Worker.Jobs.Push;
using Xunit;

namespace Patika.Worker.Tests;

public sealed class CostGuardTests
{
    [Fact]
    public async Task TopLevelCapsAreBoundAndEnforcedWithoutAProvider()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["CostGuard:MaxPushesPerDay"] = "1",
            ["CostGuard:MaxEmailsPerDay"] = "2",
            ["CostGuard:MaxCriticalEmailsPerDay"] = "7",
        }).Build();
        var services = new ServiceCollection();
        services.AddPushServices(config);
        services.AddSingleton<IPushCounterStore>(new InMemoryPushCounters());
        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();
        var guard = scope.ServiceProvider.GetRequiredService<PushCostGuard>();
        Assert.Equal(1, await guard.ReserveAsync(10, false, Ct));
        Assert.Equal(0, await guard.ReserveAsync(1, false, Ct));
        var status = await guard.StatusAsync(Ct);
        Assert.Equal(2, status.Email.Cap);
        Assert.Equal(7, status.CriticalEmail.Cap);
    }

    [Fact]
    public async Task EmailBudgetAlsoRaisesTheMaskedCostAlert()
    {
        var counters = new InMemoryPushCounters();
        var guard = Guard(counters);
        var notifier = new RecordingAlertNotifier();
        var job = new CostGuardJob(guard, notifier, new CostGuardAlertState());
        var day = PushCostGuard.Today(Now);
        await counters.ReserveAsync(day, PushCostGuard.EmailChannel, 5_000, 5_000, Ct);
        var status = await job.RunOnceAsync(Ct);
        Assert.True(status.EmailsPaused);
        Assert.False(status.CriticalEmailsPaused);
        Assert.False(status.NonCriticalPaused);
        Assert.Equal(5_000, status.Email.Used);
        var alert = Assert.Single(notifier.Alerts);
        Assert.Equal((CostAlertKind.Email, CostAlertLevel.Paused), (alert.Usage.Kind, alert.Level));
    }

    [Fact]
    public async Task EachBudgetAlertsAt80PercentAndAtTheCapOncePerDay()
    {
        var counters = new InMemoryPushCounters();
        var settings = new PushSettings { CostGuard = new CostGuardSettings { DailyCap = 100, CriticalDailyCap = 250 } };
        settings.CostGuard.MaxEmailsPerDay = 10;
        settings.CostGuard.MaxCriticalEmailsPerDay = 20;
        var clock = new FixedClock(Now);
        var guard = new PushCostGuard(counters, Options.Create(settings), clock);
        var notifier = new RecordingAlertNotifier();
        var job = new CostGuardJob(guard, notifier, new CostGuardAlertState());
        var day = PushCostGuard.Today(Now);

        await counters.ReserveAsync(day, PushCostGuard.Channel, 79, 100, Ct);
        await counters.ReserveAsync(day, PushCostGuard.CriticalEmailChannel, 16, 20, Ct);
        await job.RunOnceAsync(Ct);
        Assert.Equal([(CostAlertKind.CriticalEmail, CostAlertLevel.Warning)], Seen());

        await counters.ReserveAsync(day, PushCostGuard.Channel, 1, 100, Ct);
        await counters.ReserveAsync(day, PushCostGuard.UrgentChannel, 250, 250, Ct);
        await job.RunOnceAsync(Ct);
        await job.RunOnceAsync(Ct);
        Assert.Equal([
            (CostAlertKind.CriticalEmail, CostAlertLevel.Warning),
            (CostAlertKind.Push, CostAlertLevel.Warning),
            (CostAlertKind.UrgentPush, CostAlertLevel.Paused),
        ], Seen());

        await counters.ReserveAsync(day, PushCostGuard.CriticalEmailChannel, 4, 20, Ct);
        var status = await job.RunOnceAsync(Ct);
        Assert.True(status.CriticalPaused);
        Assert.True(status.CriticalEmailsPaused);
        Assert.Equal((CostAlertKind.CriticalEmail, CostAlertLevel.Paused), Seen()[^1]);
        Assert.Equal(4, notifier.Alerts.Count);

        // A new local day starts every budget and every alert again.
        clock.Now = Now.AddDays(1);
        await counters.ReserveAsync(PushCostGuard.Today(clock.Now), PushCostGuard.Channel, 100, 100, Ct);
        await job.RunOnceAsync(Ct);
        Assert.Equal((CostAlertKind.Push, CostAlertLevel.Paused), Seen()[^1]);

        List<(CostAlertKind, CostAlertLevel)> Seen() => [.. notifier.Alerts.Select(a => (a.Usage.Kind, a.Level))];
    }

    [Fact]
    public void LevelsAreComputedFromTheCap()
    {
        Assert.Null(new BudgetUsage(CostAlertKind.Push, 79, 100).Level);
        Assert.Equal(CostAlertLevel.Warning, new BudgetUsage(CostAlertKind.Push, 80, 100).Level);
        Assert.Equal(CostAlertLevel.Paused, new BudgetUsage(CostAlertKind.Push, 100, 100).Level);
        Assert.Equal(CostAlertLevel.Paused, new BudgetUsage(CostAlertKind.Push, 0, 0).Level);
    }

    private static readonly DateTimeOffset Now = new(2026, 10, 25, 12, 0, 0, TimeSpan.Zero);

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static PushCostGuard Guard(IPushCounterStore counters, int soft = 100, int hard = 250, int perAuthor = 1_000) =>
        new(counters, Options.Create(new PushSettings
        {
            MaxDevicesPerAuthorPerDay = perAuthor,
            CostGuard = new CostGuardSettings { DailyCap = soft, CriticalDailyCap = hard },
        }), new FixedClock(Now));

    [Fact]
    public async Task NonCriticalAndUrgentSendsHaveSeparateCounters()
    {
        var guard = Guard(new InMemoryPushCounters());

        Assert.Equal(80, await guard.ReserveAsync(80, critical: false, Ct));
        Assert.Equal(20, await guard.ReserveAsync(50, critical: false, Ct));
        Assert.Equal(0, await guard.ReserveAsync(1, critical: false, Ct));
        Assert.True((await guard.StatusAsync(Ct)).NonCriticalPaused);

        // Non-critical traffic used none of the urgent budget.
        Assert.Equal(250, await guard.ReserveAsync(500, critical: true, Ct));
        Assert.Equal(0, await guard.ReserveAsync(1, critical: true, Ct));
        var status = await guard.StatusAsync(Ct);
        Assert.True(status.CriticalPaused);
        Assert.Equal(100, status.Push.Used);
        Assert.Equal(250, status.UrgentPush.Used);
    }

    [Fact]
    public async Task UnusedGrantsAreReleased()
    {
        var guard = Guard(new InMemoryPushCounters());
        Assert.Equal(100, await guard.ReserveAsync(100, critical: false, Ct));
        await guard.ReleaseAsync(40, critical: false, Ct);
        Assert.Equal(60, (await guard.StatusAsync(Ct)).Push.Used);
        Assert.Equal(40, await guard.ReserveAsync(90, critical: false, Ct));
    }

    [Fact]
    public async Task UrgentReservationsAreBoundedPerAuthorAndReportWhichLimitApplied()
    {
        var counters = new InMemoryPushCounters();
        var guard = Guard(counters, hard: 250, perAuthor: 120);
        var author = Guid.CreateVersion7();
        var other = Guid.CreateVersion7();

        Assert.Equal(new UrgentGrant(100, UrgentLimit.None), await guard.ReserveUrgentAsync(author, 100, Ct));
        Assert.Equal(new UrgentGrant(20, UrgentLimit.Author), await guard.ReserveUrgentAsync(author, 100, Ct));
        Assert.Equal(new UrgentGrant(0, UrgentLimit.Author), await guard.ReserveUrgentAsync(author, 1, Ct));
        Assert.Equal(new UrgentGrant(120, UrgentLimit.None), await guard.ReserveUrgentAsync(other, 120, Ct));

        // 240 of 250 urgent sends are used: a third author gets the last 10, limited by the daily counter,
        // and the author budget it could not use is returned.
        var third = Guid.CreateVersion7();
        Assert.Equal(new UrgentGrant(10, UrgentLimit.Daily), await guard.ReserveUrgentAsync(third, 50, Ct));
        Assert.Equal(10, await counters.CountAsync(PushCostGuard.Today(Now), PushCostGuard.AuthorChannel(third), Ct));

        await guard.ReleaseUrgentAsync(author, 30, Ct);
        Assert.Equal(220, (await guard.StatusAsync(Ct)).UrgentPush.Used);
        Assert.Equal(90, await counters.CountAsync(PushCostGuard.Today(Now), PushCostGuard.AuthorChannel(author), Ct));
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
            [new FanoutRecipient(Guid.CreateVersion7(), author, "author-token"),
                .. Enumerable.Range(0, 700).Select(i => new FanoutRecipient(Guid.CreateVersion7(), Guid.CreateVersion7(), $"token-{i}"))]);
        var sender = new FakePushSender();
        sender.Invalid.Add("token-3");
        var fanout = Fanout(store, sender, new InMemoryPushCounters());

        var summary = Assert.Single(await fanout.RunOnceAsync(Ct));

        Assert.Equal(499, summary.Recipients);
        Assert.Equal(498, sender.Sent.Count);
        Assert.DoesNotContain(sender.Sent, m => m.Token == "author-token");
        Assert.All(sender.Sent, m => Assert.True(m.Critical));
        Assert.All(sender.Sent, m => Assert.Equal(["category", "type", "urgentId"], m.Data.Keys.Order()));
        Assert.Equal(498, store.Notified[post.Id]);
        Assert.Null(summary.DeferredUntil);
        Assert.Empty(store.Deferred);
        Assert.Single(store.Removed);
        Assert.Equal(500, store.RequestedCap);
        Assert.Equal(2000, store.RequestedRadius);
    }

    [Fact]
    public async Task ACappedFanoutIsDeferredNotCompletedAndTheRestIsSentInTheNextWindow()
    {
        var post = new FanoutPost(Guid.CreateVersion7(), Guid.CreateVersion7(), 41.0, 29.0, "Sick");
        var store = new ScriptedFanoutStore(post,
            [.. Enumerable.Range(0, 50).Select(i => new FanoutRecipient(Guid.CreateVersion7(), Guid.CreateVersion7(), $"t-{i}"))]);
        var sender = new FakePushSender();
        var counters = new InMemoryPushCounters();
        var clock = new FixedClock(new DateTimeOffset(2026, 10, 25, 18, 30, 0, TimeSpan.Zero));
        var fanout = Fanout(store, sender, counters, criticalCap: 30, clock: clock);

        var first = Assert.Single(await fanout.RunOnceAsync(Ct));

        Assert.Equal(30, first.Granted);
        Assert.Equal(30, sender.Sent.Count);
        Assert.False(store.Notified.ContainsKey(post.Id));
        var deferral = Assert.Single(store.Deferred);
        Assert.Equal((30, 30), (deferral.Notified, deferral.Offset));
        // 18:30 UTC is 21:30 local: the budgets reset at local midnight, 21:00 UTC.
        Assert.Equal(new DateTimeOffset(2026, 10, 25, 21, 0, 0, TimeSpan.Zero), deferral.RetryAt);
        Assert.Equal(deferral.RetryAt, first.DeferredUntil);

        clock.Now = deferral.RetryAt;
        store.Requeue(post with { Offset = deferral.Offset, Notified = deferral.Notified });
        var second = Assert.Single(await fanout.RunOnceAsync(Ct));

        Assert.Equal(20, second.Granted);
        Assert.Equal(50, sender.Sent.Count);
        Assert.Equal(50, sender.Sent.Select(m => m.Token).Distinct().Count());
        Assert.Equal(50, store.Notified[post.Id]);
        Assert.Equal(30, store.LastOffset);
    }

    [Fact]
    public async Task OneAuthorCannotUseTheWholeUrgentBudget()
    {
        var author = Guid.CreateVersion7();
        var counters = new InMemoryPushCounters();
        var sender = new FakePushSender();
        var recipients = Enumerable.Range(0, 400).Select(i => new FanoutRecipient(Guid.CreateVersion7(), Guid.CreateVersion7(), $"a-{i}")).ToList();

        var first = new ScriptedFanoutStore(new FanoutPost(Guid.CreateVersion7(), author, 41.0, 29.0, "Injured"), recipients);
        Assert.Equal(400, Assert.Single(await Fanout(first, sender, counters, perAuthor: 600).RunOnceAsync(Ct)).Sent);
        var second = new ScriptedFanoutStore(new FanoutPost(Guid.CreateVersion7(), author, 41.0, 29.0, "Injured"), recipients);
        var capped = Assert.Single(await Fanout(second, sender, counters, perAuthor: 600).RunOnceAsync(Ct));

        Assert.Equal(200, capped.Sent);
        Assert.NotNull(capped.DeferredUntil);
        Assert.Equal(200, Assert.Single(second.Deferred).Offset);

        // Another author nearby is not affected.
        var third = new ScriptedFanoutStore(new FanoutPost(Guid.CreateVersion7(), Guid.CreateVersion7(), 41.0, 29.0, "Injured"), recipients);
        Assert.Equal(400, Assert.Single(await Fanout(third, sender, counters, perAuthor: 600).RunOnceAsync(Ct)).Sent);
    }

    private static UrgentFanout Fanout(
        IUrgentFanoutStore store, IPushSender sender, IPushCounterStore counters, int criticalCap = 20_000, int perAuthor = 1_000,
        FixedClock? clock = null)
    {
        var settings = Options.Create(new PushSettings
        {
            MaxDevicesPerPost = 10_000,
            MaxRadiusMeters = 50_000,
            MaxDevicesPerAuthorPerDay = perAuthor,
            CostGuard = new CostGuardSettings { DailyCap = 10, CriticalDailyCap = criticalCap },
        });
        clock ??= new FixedClock(DateTimeOffset.UtcNow);
        return new UrgentFanout(store, sender, new PushCostGuard(counters, settings, clock), settings, clock, NullLogger<UrgentFanout>.Instance);
    }

    /// <summary>Returns more candidates than allowed, to prove the service caps independently of the query.</summary>
    private sealed class ScriptedFanoutStore(FanoutPost post, IReadOnlyList<FanoutRecipient> recipients) : IUrgentFanoutStore
    {
        private FanoutPost? pending = post;

        public Dictionary<Guid, int> Notified { get; } = [];

        public List<(int Notified, int Offset, DateTimeOffset RetryAt)> Deferred { get; } = [];

        public List<Guid> Removed { get; } = [];

        public int RequestedCap { get; private set; }

        public int RequestedRadius { get; private set; }

        public int LastOffset { get; private set; }

        public void Requeue(FanoutPost again) => pending = again;

        public Task<IReadOnlyList<FanoutPost>> ClaimAsync(
            DateTimeOffset now, DateTimeOffset createdSince, DateTimeOffset deferredSince, int batch, CancellationToken cancellationToken)
        {
            IReadOnlyList<FanoutPost> result = pending is null ? [] : [pending];
            pending = null;
            return Task.FromResult(result);
        }

        public Task<IReadOnlyList<FanoutRecipient>> RecipientsAsync(
            FanoutPost fanoutPost, int maxRadiusMeters, int cap, int offset, DateTimeOffset seenSince, CancellationToken cancellationToken)
        {
            RequestedCap = cap;
            RequestedRadius = maxRadiusMeters;
            LastOffset = offset;
            return Task.FromResult<IReadOnlyList<FanoutRecipient>>([.. recipients.Skip(offset)]);
        }

        public Task CompleteAsync(Guid postId, int notified, CancellationToken cancellationToken)
        {
            Notified[postId] = notified;
            return Task.CompletedTask;
        }

        public Task DeferAsync(Guid postId, int notified, int offset, DateTimeOffset retryAt, CancellationToken cancellationToken)
        {
            Deferred.Add((notified, offset, retryAt));
            return Task.CompletedTask;
        }

        public Task RemoveDevicesAsync(IReadOnlyCollection<Guid> deviceIds, CancellationToken cancellationToken)
        {
            Removed.AddRange(deviceIds);
            return Task.CompletedTask;
        }
    }
}
