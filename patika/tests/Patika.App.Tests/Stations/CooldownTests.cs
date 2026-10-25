using System.Net;
using System.Text;
using Patika.App.Core.Api;
using Patika.App.Core.Map;
using Patika.App.Core.Offline;
using Patika.Contracts.Community;
using Patika.Contracts.Geo;
using Xunit;

namespace Patika.App.Tests.Stations;

/// <summary>A clock whose wall time can jump (the user changes it) while the monotonic clock runs on.</summary>
internal sealed class SkewClock : TimeProvider
{
    private DateTimeOffset wall = new(2026, 10, 25, 9, 0, 0, TimeSpan.Zero);
    private long ticks = 1_000_000;

    public override DateTimeOffset GetUtcNow() => wall;

    public override long GetTimestamp() => ticks;

    public override long TimestampFrequency => TimeSpan.TicksPerSecond;

    /// <summary>Real time passes: both clocks move.</summary>
    public void Advance(TimeSpan by)
    {
        wall += by;
        ticks += by.Ticks;
    }

    /// <summary>Only the phone's wall clock changes.</summary>
    public void Jump(TimeSpan by) => wall += by;
}

/// <summary>The real client, outbox, replayer and planner with the cooldown-aware sender, against a fake API.</summary>
public sealed class CooldownTests : IDisposable
{
    private const string UserId = "4f1c2b8e-0000-4000-8000-0000000000cc";

    private readonly TempDatabase db = new();
    private readonly SkewClock clock = new();
    private readonly MemoryTokenStore store = new() { Session = new StoredSession("refresh-0", UserId) };
    private readonly FakeNetwork network = new();
    private readonly TokenManager tokens;
    private readonly Outbox outbox;
    private readonly OutboxReplayer replayer;
    private readonly FieldActions actions;
    private readonly CooldownBook book;
    private readonly FeedPlanner planner;
    private readonly FakeHandler handler;
    private readonly PatikaApiClient api;
    private DateTimeOffset? serverDate;
    private Func<HttpResponseMessage> feeding = () => Http.Json(HttpStatusCode.Created,
        new FeedingResponse(Guid.NewGuid(), DateTimeOffset.UtcNow, null, null, true, "Ayşe"));

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public CooldownTests()
    {
        handler = new FakeHandler(request =>
        {
            var response = request.Path == "/v1/auth/refresh" ? Http.Json(HttpStatusCode.OK, Http.Tokens(UserId, "1")) : feeding();
            response.Headers.Date = serverDate;
            return Http.Done(response);
        });
        tokens = new TokenManager(store, clock);
        api = new PatikaApiClient(new HttpClient(handler), tokens, new ApiOptions { BaseAddress = new Uri("http://api.test/") })
        {
            ServerTime = new ServerTime(clock),
        };
        outbox = new Outbox(db.Database, clock);
        book = new CooldownBook(tokens, clock, api.ServerTime);
        replayer = new OutboxReplayer(outbox, new CooldownAwareSender(new ApiOutboxSender(api), book), tokens, network, clock);
        actions = new FieldActions(outbox, replayer, tokens, network);
        planner = new FeedPlanner(actions, outbox, book, tokens, clock);
    }

    public void Dispose()
    {
        replayer.Dispose();
        db.Dispose();
    }

    private static StationDetail Detail(Guid id, params FeedingResponse[] feedings) => new(
        new StationResponse(id, "Moda", new CoordinateDto(40.98, 29.02), "Food", "Cat", "station/x", "Active", null, feedings.Length),
        feedings);

    private int FeedingPosts => handler.Requests.Count(r => r.Path.EndsWith("/feedings", StringComparison.Ordinal));

    private static HttpResponseMessage Cooldown(int? bodySeconds, int? headerSeconds)
    {
        var extra = bodySeconds is { } s ? $",\"retryAfterSeconds\":{s}" : "";
        var response = new HttpResponseMessage(HttpStatusCode.Conflict)
        {
            Content = new StringContent(
                $"{{\"type\":\"about:blank\",\"title\":\"Besleme için bekleyin.\",\"status\":409,\"code\":\"feeding_cooldown\"{extra}}}",
                Encoding.UTF8, "application/problem+json"),
        };
        if (headerSeconds is { } h)
        {
            response.Headers.RetryAfter = new System.Net.Http.Headers.RetryConditionHeaderValue(TimeSpan.FromSeconds(h));
        }

        return response;
    }

    [Fact]
    public async Task A_refused_feeding_waits_exactly_the_retry_after_seconds_the_server_sent()
    {
        await tokens.RestoreAsync();
        var station = Guid.NewGuid();
        feeding = () => Cooldown(bodySeconds: 1320, headerSeconds: 1300);

        var decision = await planner.FeedAsync(Detail(station), Ct);

        Assert.Equal(FeedOutcome.Cooldown, decision.Outcome);
        Assert.Equal(TimeSpan.FromMinutes(22), decision.Remaining);
        Assert.Equal(TimeSpan.FromMinutes(22), book.Remaining(UserId, station));
        Assert.Empty(await outbox.ListAsync(UserId, Ct));
    }

    [Fact]
    public async Task Without_the_body_member_the_retry_after_header_is_used()
    {
        await tokens.RestoreAsync();
        var station = Guid.NewGuid();
        feeding = () => Cooldown(bodySeconds: null, headerSeconds: 600);

        await actions.FeedAsync(station, new FeedingDraft(), Ct);

        Assert.Equal(TimeSpan.FromSeconds(600), book.Remaining(UserId, station));
    }

    [Fact]
    public async Task The_wait_counts_down_on_the_monotonic_clock_whatever_the_phone_clock_does()
    {
        await tokens.RestoreAsync();
        var station = Guid.NewGuid();

        Assert.Equal(FeedOutcome.Sent, (await planner.FeedAsync(Detail(station), Ct)).Outcome);
        clock.Jump(TimeSpan.FromHours(2)); // the user sets the clock forward
        Assert.Equal(CooldownBook.Window, book.Remaining(UserId, station));
        clock.Jump(TimeSpan.FromHours(-5)); // and far back
        clock.Advance(TimeSpan.FromMinutes(10));
        Assert.Equal(TimeSpan.FromMinutes(20), book.Remaining(UserId, station));
        Assert.Null(book.Remaining("someone-else", station));

        // A second tap inside the window is answered from the book, without a request.
        var again = await planner.FeedAsync(Detail(station), Ct);
        Assert.Equal(FeedOutcome.Cooldown, again.Outcome);
        Assert.Equal(1, FeedingPosts);

        clock.Advance(TimeSpan.FromMinutes(20));
        Assert.Null(book.Remaining(UserId, station));
        Assert.Equal(FeedOutcome.Sent, (await planner.FeedAsync(Detail(station), Ct)).Outcome);
        Assert.Equal(2, FeedingPosts);
    }

    [Fact]
    public async Task After_a_restart_the_own_feeding_in_the_detail_is_measured_against_the_server_clock()
    {
        await tokens.RestoreAsync();
        var station = Guid.NewGuid();
        var serverNow = new DateTimeOffset(2026, 10, 25, 10, 0, 0, TimeSpan.Zero);
        var detail = Detail(station,
            new FeedingResponse(Guid.NewGuid(), serverNow.AddMinutes(-2), null, null, IsMine: false, "Ayşe"),
            new FeedingResponse(Guid.NewGuid(), serverNow.AddMinutes(-10), null, null, IsMine: true, "Ben"));

        // The phone is 20 minutes ahead of the server; without server time it would think the wait is over.
        clock.Jump(serverNow.AddMinutes(20) - clock.GetUtcNow());
        Assert.Null(book.Remaining(UserId, station, detail));

        serverDate = serverNow;
        await api.SendAsync<object>(HttpMethod.Get, "me", null, AuthMode.Optional, ct: Ct);

        Assert.Equal(TimeSpan.FromMinutes(20), book.Remaining(UserId, station, detail));
        clock.Advance(TimeSpan.FromMinutes(5));
        Assert.Equal(TimeSpan.FromMinutes(15), book.Remaining(UserId, station, detail));
    }

    [Fact]
    public async Task Sign_out_wipes_the_book()
    {
        await tokens.RestoreAsync();
        var station = Guid.NewGuid();
        book.RecordSent(UserId, station);

        await tokens.SignOutAsync();

        Assert.Null(book.Remaining(UserId, station));
    }

    [Fact]
    public async Task Offline_the_record_is_queued_a_second_tap_adds_nothing_and_after_replay_the_server_cooldown_takes_over()
    {
        await tokens.RestoreAsync();
        var station = Guid.NewGuid();
        network.Set(false);

        var first = await planner.FeedAsync(Detail(station), Ct);
        Assert.Equal(FeedOutcome.Queued, first.Outcome);

        // Pending duplicate prevention: not the server's 30 minutes, and not ended by the clock.
        clock.Advance(TimeSpan.FromHours(3));
        var second = await planner.FeedAsync(Detail(station), Ct);
        Assert.Equal(FeedOutcome.AlreadyQueued, second.Outcome);
        Assert.Equal(first.RecordedAt, second.RecordedAt);
        Assert.Single(await outbox.ListAsync(UserId, Ct));
        Assert.Null(book.Remaining(UserId, station));
        Assert.Equal(0, FeedingPosts);

        // Back online but the server fails: the record stays pending and still blocks a duplicate.
        feeding = () => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
        network.Set(true);
        await replayer.ReplayAsync(Ct);
        Assert.Equal(FeedOutcome.AlreadyQueued, (await planner.FeedAsync(Detail(station), Ct)).Outcome);
        Assert.Equal(1, FeedingPosts);

        // The retry goes through: the queue is empty and the server's cooldown starts from that receipt.
        feeding = () => Http.Json(HttpStatusCode.Created, new FeedingResponse(Guid.NewGuid(), DateTimeOffset.UtcNow, null, null, true, "Ayşe"));
        clock.Advance(Backoff.After(1));
        await replayer.ReplayAsync(Ct);
        Assert.Empty(await outbox.ListAsync(UserId, Ct));
        Assert.Equal(CooldownBook.Window, book.Remaining(UserId, station));

        var third = await planner.FeedAsync(Detail(station), Ct);
        Assert.Equal(FeedOutcome.Cooldown, third.Outcome);
        Assert.Equal(2, FeedingPosts);
    }
}
