using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;
using Patika.App.Core.Api;
using Patika.App.Core.Offline;
using Patika.Contracts.Community;
using Xunit;

namespace Patika.App.Tests;

/// <summary>
/// Drives the real client, outbox and replayer against a fake server that, like the API with
/// Idempotency-Key support, stores each key once and answers a repeat with the stored result.
/// </summary>
public sealed class OutboxReplayTests : IDisposable
{
    private const string UserId = "4f1c2b8e-0000-4000-8000-0000000000aa";

    private readonly TempDatabase db = new();
    private readonly ManualClock clock = new();
    private readonly FakeNetwork network = new();
    private readonly MemoryTokenStore store = new() { Session = new StoredSession("refresh-0", UserId) };
    private readonly ConcurrentDictionary<string, string> serverRows = new();
    private readonly ConcurrentQueue<string> serverOrder = new();
    private readonly Outbox outbox;
    private readonly TokenManager tokens;
    private readonly OutboxReplayer replayer;
    private readonly FieldActions actions;
    private readonly FakeHandler handler;
    private readonly GatedSender gated;

    /// <summary>What the fake server does with the next feeding POST; defaults to storing it.</summary>
    private Func<RecordedRequest, HttpResponseMessage?>? feedingOverride;

    public OutboxReplayTests()
    {
        handler = new FakeHandler(Respond);
        tokens = new TokenManager(store, clock);
        var api = new PatikaApiClient(new HttpClient(handler), tokens, new ApiOptions { BaseAddress = new Uri("http://api.test/") });
        outbox = new Outbox(db.Database, clock);
        gated = new GatedSender(new ApiOutboxSender(api));
        replayer = new OutboxReplayer(outbox, gated, tokens, network, clock);
        actions = new FieldActions(outbox, replayer, tokens, network);
    }

    public void Dispose()
    {
        replayer.Dispose();
        db.Dispose();
    }

    private Task<HttpResponseMessage> Respond(RecordedRequest request)
    {
        if (request.Path == "/v1/auth/refresh")
        {
            return Http.Done(Http.Json(HttpStatusCode.OK, Http.Tokens(UserId, "1")));
        }

        if (request.Path.EndsWith("/feedings", StringComparison.Ordinal) && feedingOverride?.Invoke(request) is { } custom)
        {
            return Http.Done(custom);
        }

        var key = request.IdempotencyKey!;
        if (serverRows.TryAdd(key, request.Path))
        {
            serverOrder.Enqueue(request.Path);
        }

        return Http.Done(request.Path.EndsWith("/needs-refill", StringComparison.Ordinal)
            ? new HttpResponseMessage(HttpStatusCode.NoContent)
            : Http.Json(HttpStatusCode.Created, new FeedingResponse(Guid.NewGuid(), clock.GetUtcNow(), null, null)));
    }

    private async Task SignedInAsync() => await tokens.RestoreAsync();

    [Fact]
    public async Task Offline_records_wait_and_replay_once_in_order_when_back_online()
    {
        await SignedInAsync();
        network.Set(false);
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();
        var c = Guid.NewGuid();

        var first = await actions.FeedAsync(a, new FeedingDraft(Note: "kuru mama"), TestContext.Current.CancellationToken);
        clock.Advance(TimeSpan.FromMinutes(1));
        await actions.ReportEmptyAsync(b, TestContext.Current.CancellationToken);
        clock.Advance(TimeSpan.FromMinutes(1));
        await actions.FeedAsync(c, new FeedingDraft(), TestContext.Current.CancellationToken);

        Assert.Equal(SubmitOutcome.Queued, first.Outcome);
        Assert.Empty(handler.Requests);
        Assert.Equal(3, await outbox.CountPendingAsync(UserId, TestContext.Current.CancellationToken));

        network.Set(true);
        var result = await replayer.ReplayAsync(TestContext.Current.CancellationToken);
        var again = await replayer.ReplayAsync(TestContext.Current.CancellationToken);

        Assert.Equal(3, result.Sent);
        Assert.Equal(0, again.Sent);
        Assert.Equal([$"/v1/stations/{a}/feedings", $"/v1/stations/{b}/needs-refill", $"/v1/stations/{c}/feedings"], serverOrder);
        Assert.Equal(3, serverRows.Count);
        Assert.Empty(await outbox.ListAsync(UserId, TestContext.Current.CancellationToken));

        var body = JsonDocument.Parse(handler.Requests.First(r => r.Path.EndsWith($"{a}/feedings", StringComparison.Ordinal)).Body!).RootElement;
        Assert.Equal("kuru mama", body.GetProperty("note").GetString());
        Assert.Equal(first.Item.ClientCreatedAt, body.GetProperty("clientCreatedAt").GetDateTimeOffset());
    }

    [Fact]
    public async Task A_lost_response_is_retried_with_the_same_key_and_stored_once()
    {
        await SignedInAsync();
        var station = Guid.NewGuid();
        var lose = true;
        feedingOverride = request =>
        {
            if (!lose)
            {
                return null;
            }

            // The server stores the row, then the connection drops before the answer arrives.
            lose = false;
            serverRows.TryAdd(request.IdempotencyKey!, request.Path);
            throw new HttpRequestException("connection reset");
        };

        var submitted = await actions.FeedAsync(station, new FeedingDraft(), TestContext.Current.CancellationToken);
        Assert.Equal(SubmitOutcome.Queued, submitted.Outcome);
        var deferred = Assert.Single(await outbox.ListAsync(UserId, TestContext.Current.CancellationToken));
        Assert.Equal(1, deferred.Attempts);
        Assert.Equal(clock.GetUtcNow() + Backoff.After(1), deferred.NextAttemptAt);

        Assert.Equal(0, (await replayer.ReplayAsync(TestContext.Current.CancellationToken)).Sent);
        clock.Advance(Backoff.After(1));
        var result = await replayer.ReplayAsync(TestContext.Current.CancellationToken);

        Assert.Equal(1, result.Sent);
        var keys = handler.Requests.Where(r => r.Path.EndsWith("/feedings", StringComparison.Ordinal)).Select(r => r.IdempotencyKey).ToArray();
        Assert.Equal(2, keys.Length);
        Assert.Equal(keys[0], keys[1]);
        Assert.Single(serverRows);
    }

    [Fact]
    public async Task A_transient_failure_stops_the_run_so_later_items_never_overtake()
    {
        await SignedInAsync();
        network.Set(false);
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();
        await actions.FeedAsync(a, new FeedingDraft(), TestContext.Current.CancellationToken);
        await actions.FeedAsync(b, new FeedingDraft(), TestContext.Current.CancellationToken);
        network.Set(true);
        feedingOverride = request => request.Path.Contains(a.ToString(), StringComparison.Ordinal) && serverRows.IsEmpty
            ? Http.Problem(503, "http_503")
            : null;

        var first = await replayer.ReplayAsync(TestContext.Current.CancellationToken);

        Assert.Equal(0, first.Sent);
        Assert.Equal(2, first.Remaining);
        Assert.DoesNotContain(handler.Requests, r => r.Path.Contains(b.ToString(), StringComparison.Ordinal));

        feedingOverride = null;
        clock.Advance(Backoff.After(1));
        var second = await replayer.ReplayAsync(TestContext.Current.CancellationToken);

        Assert.Equal(2, second.Sent);
        Assert.Equal([$"/v1/stations/{a}/feedings", $"/v1/stations/{b}/feedings"], serverOrder);
    }

    [Fact]
    public async Task A_final_refusal_is_kept_as_rejected_and_the_rest_still_goes()
    {
        await SignedInAsync();
        network.Set(false);
        var cooled = Guid.NewGuid();
        var other = Guid.NewGuid();
        await actions.FeedAsync(cooled, new FeedingDraft(), TestContext.Current.CancellationToken);
        await actions.FeedAsync(other, new FeedingDraft(), TestContext.Current.CancellationToken);
        feedingOverride = request => request.Path.Contains(cooled.ToString(), StringComparison.Ordinal)
            ? Http.Problem(409, ErrorCodes.FeedingCooldown)
            : null;
        network.Set(true);

        var result = await replayer.ReplayAsync(TestContext.Current.CancellationToken);

        Assert.Equal(1, result.Sent);
        Assert.Equal(1, result.Rejected);
        var left = Assert.Single(await outbox.ListAsync(UserId, TestContext.Current.CancellationToken));
        Assert.Equal(OutboxState.Rejected, left.State);
        Assert.Equal(ErrorCodes.FeedingCooldown, left.ErrorCode);
        Assert.Equal(0, await outbox.CountPendingAsync(UserId, TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task Overlapping_replays_send_each_item_once()
    {
        await SignedInAsync();
        network.Set(false);
        for (var i = 0; i < 5; i++)
        {
            await actions.FeedAsync(Guid.NewGuid(), new FeedingDraft(), TestContext.Current.CancellationToken);
        }

        network.Set(true);
        await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => replayer.ReplayAsync(TestContext.Current.CancellationToken)));

        Assert.Equal(5, handler.Count("/v1/stations/"));
        Assert.Equal(5, serverRows.Count);
        Assert.Equal(0, await outbox.CountPendingAsync(UserId, TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task Online_submit_reports_sent_and_a_cooldown_reports_rejected_without_queueing()
    {
        await SignedInAsync();
        var station = Guid.NewGuid();

        var sent = await actions.FeedAsync(station, new FeedingDraft(), TestContext.Current.CancellationToken);
        feedingOverride = _ => Http.Problem(409, ErrorCodes.FeedingCooldown);
        var refused = await actions.FeedAsync(station, new FeedingDraft(), TestContext.Current.CancellationToken);

        Assert.Equal(SubmitOutcome.Sent, sent.Outcome);
        Assert.Equal(SubmitOutcome.Rejected, refused.Outcome);
        Assert.Equal(ErrorCodes.FeedingCooldown, refused.ErrorCode);
        Assert.Empty(await outbox.ListAsync(UserId, TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task Sign_out_wipes_the_outbox_and_signing_in_drops_other_accounts_items()
    {
        await SignedInAsync();
        using var guard = new SessionDataGuard(tokens, outbox, new MapCache(db.Database, clock));
        network.Set(false);
        await actions.FeedAsync(Guid.NewGuid(), new FeedingDraft(), Ct);
        await outbox.EnqueueAsync("someone-else", OutboxKinds.Feeding, Guid.NewGuid().ToString(), "{}", Ct);

        await tokens.AcceptAsync(Http.Tokens(UserId, "2"));
        await guard.Pending;
        Assert.Empty(await outbox.ListAsync("someone-else", Ct));
        Assert.Single(await outbox.ListAsync(UserId, Ct));

        // The wipe is part of sign-out itself, not a background task.
        await tokens.SignOutAsync();
        Assert.Empty(await outbox.ListAsync(UserId, Ct));
        Assert.Null(store.Session);
    }

    [Fact]
    public async Task A_record_held_before_send_is_never_sent_with_the_next_accounts_token()
    {
        const string other = "4f1c2b8e-0000-4000-8000-0000000000bb";
        await SignedInAsync();
        network.Set(false);
        var mine = await actions.FeedAsync(Guid.NewGuid(), new FeedingDraft(), Ct);
        network.Set(true);

        // Hold A's record after the replayer read it and before the client attaches a token; the gate
        // also drops the pass cancellation, so only the session binding in the client can stop the send.
        var arrived = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        gated.BeforeSend = async () =>
        {
            arrived.TrySetResult();
            await release.Task;
        };
        var pass = replayer.ReplayAsync(Ct);
        await arrived.Task;
        await tokens.AcceptAsync(Http.Tokens(other, "b"));
        release.SetResult();
        await pass;
        gated.BeforeSend = null;

        Assert.DoesNotContain(handler.Requests, r => r.Path.EndsWith("/feedings", StringComparison.Ordinal)
            && r.Bearer == Http.Jwt(other, "b"));
        Assert.Empty(serverRows);
        Assert.Equal(mine.Item.IdempotencyKey, Assert.Single(await outbox.ListAsync(UserId, Ct)).IdempotencyKey);

        // B's own record goes out with B's token; A's stays behind for A.
        var theirs = await actions.FeedAsync(Guid.NewGuid(), new FeedingDraft(), Ct);
        Assert.Equal(SubmitOutcome.Sent, theirs.Outcome);
        var sent = Assert.Single(handler.Requests, r => r.Path.EndsWith("/feedings", StringComparison.Ordinal));
        Assert.Equal(Http.Jwt(other, "b"), sent.Bearer);
        Assert.Equal(theirs.Item.IdempotencyKey, sent.IdempotencyKey);
        Assert.Single(await outbox.ListAsync(UserId, Ct));
    }

    [Theory]
    [InlineData("not-a-guid", "{}")]
    [InlineData("4f1c2b8e-0000-4000-8000-0000000000cc", "{not json")]
    public async Task An_unreadable_record_is_set_aside_and_the_next_one_still_goes(string target, string payload)
    {
        await SignedInAsync();
        await outbox.EnqueueAsync(UserId, OutboxKinds.Feeding, target, payload, Ct);
        var good = await outbox.EnqueueAsync(UserId, OutboxKinds.Feeding, Guid.NewGuid().ToString(), "{}", Ct);

        var result = await replayer.ReplayAsync(Ct);

        Assert.Equal(1, result.Sent);
        var left = Assert.Single(await outbox.ListAsync(UserId, Ct));
        Assert.Equal(OutboxState.Failed, left.State);
        Assert.Equal(ErrorCodes.OutboxMalformed, left.ErrorCode);
        Assert.True(serverRows.ContainsKey(good.IdempotencyKey));
    }

    [Fact]
    public async Task A_record_that_keeps_failing_is_given_up_after_the_attempt_limit_and_unblocks_the_queue()
    {
        await SignedInAsync();
        var stuck = Guid.NewGuid();
        feedingOverride = request => request.Path.Contains(stuck.ToString(), StringComparison.Ordinal)
            ? Http.Problem(500, "http_500")
            : null;
        await actions.FeedAsync(stuck, new FeedingDraft(), Ct);
        var next = await outbox.EnqueueAsync(UserId, OutboxKinds.Feeding, Guid.NewGuid().ToString(), "{}", Ct);

        for (var i = 0; i < OutboxLimits.MaxAttempts + 2; i++)
        {
            clock.Advance(Backoff.Max);
            await replayer.ReplayAsync(Ct);
        }

        var left = Assert.Single(await outbox.ListAsync(UserId, Ct));
        Assert.Equal(OutboxState.Failed, left.State);
        Assert.Equal(ErrorCodes.OutboxExhausted, left.ErrorCode);
        Assert.Equal(OutboxLimits.MaxAttempts, left.Attempts);
        Assert.True(serverRows.ContainsKey(next.IdempotencyKey));
        Assert.Equal(new OutboxCounts(0, 1, ErrorMessages.For(ErrorCodes.OutboxExhausted, null)), await outbox.CountAsync(UserId, Ct));
    }

    [Fact]
    public async Task A_record_older_than_the_age_limit_is_given_up_on_its_next_failure()
    {
        await SignedInAsync();
        network.Set(false);
        await actions.FeedAsync(Guid.NewGuid(), new FeedingDraft(), Ct);
        network.Set(true);
        clock.Advance(OutboxLimits.MaxAge + TimeSpan.FromMinutes(1));
        feedingOverride = _ => Http.Problem(503, "http_503");

        await replayer.ReplayAsync(Ct);

        Assert.Equal(OutboxState.Failed, Assert.Single(await outbox.ListAsync(UserId, Ct)).State);
    }

    [Fact]
    public async Task Backoff_doubles_and_is_capped()
    {
        Assert.Equal(TimeSpan.FromSeconds(5), Backoff.After(1));
        Assert.Equal(TimeSpan.FromSeconds(10), Backoff.After(2));
        Assert.Equal(TimeSpan.FromSeconds(40), Backoff.After(4));
        Assert.Equal(Backoff.Max, Backoff.After(30));
        await Task.CompletedTask;
    }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;
}

/// <summary>Lets a test hold a record between the replayer reading it and the client sending it.</summary>
internal sealed class GatedSender(IOutboxSender inner) : IOutboxSender
{
    public Func<Task>? BeforeSend { get; set; }

    public async Task SendAsync(OutboxItem item, SessionBinding session, CancellationToken ct)
    {
        if (BeforeSend is { } hold)
        {
            await hold();

            // Deliberately ignore the pass cancellation so the test exercises the session binding alone.
            await inner.SendAsync(item, session, CancellationToken.None);
            return;
        }

        await inner.SendAsync(item, session, ct);
    }
}
