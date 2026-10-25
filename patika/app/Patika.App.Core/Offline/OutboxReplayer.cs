using Patika.App.Core.Api;

namespace Patika.App.Core.Offline;

/// <summary>
/// Sends one outbox item for the account and session in <paramref name="session"/>. Throws
/// <see cref="ApiException"/> on failure; success means the server has it.
/// </summary>
public interface IOutboxSender
{
    Task SendAsync(OutboxItem item, SessionBinding session, CancellationToken ct);
}

/// <summary>Retry spacing for transient failures: 5 s, 10 s, 20 s ... capped at 15 minutes.</summary>
public static class Backoff
{
    public static readonly TimeSpan First = TimeSpan.FromSeconds(5);
    public static readonly TimeSpan Max = TimeSpan.FromMinutes(15);

    /// <summary>Delay after the <paramref name="attempt"/>-th failed attempt (1-based).</summary>
    public static TimeSpan After(int attempt)
    {
        var exponent = Math.Clamp(attempt - 1, 0, 20);
        var delay = TimeSpan.FromTicks(First.Ticks * (1L << exponent));
        return delay > Max ? Max : delay;
    }
}

/// <summary>When a record that keeps failing transiently is given up as <see cref="OutboxState.Failed"/>.</summary>
public static class OutboxLimits
{
    public const int MaxAttempts = 20;

    public static readonly TimeSpan MaxAge = TimeSpan.FromDays(7);
}

public sealed record ReplayResult(int Sent, int Rejected, int Remaining, DateTimeOffset? NextAttemptAt, bool Skipped)
{
    public static ReplayResult Nothing { get; } = new(0, 0, 0, null, Skipped: true);
}

/// <summary>
/// Replays the outbox oldest first. A transient failure stops the run and backs off, so a later record
/// never overtakes an earlier one; a final refusal (4xx), an unreadable record, or a record past
/// <see cref="OutboxLimits"/> is set aside and the run moves on.
/// A pass is bound to one account and session: it reads only that owner's items, every send carries a
/// <see cref="SessionBinding"/> the client checks against the token it attaches, and any session change
/// cancels the pass. Runs never overlap: a call during a run asks for one more pass instead.
/// Triggers: start-up, sign-in, connectivity coming back, a new item, and the backoff timer.
/// </summary>
public sealed class OutboxReplayer : IDisposable
{
    private readonly Outbox outbox;
    private readonly IOutboxSender sender;
    private readonly TokenManager tokens;
    private readonly INetworkStatus network;
    private readonly TimeProvider clock;
    private readonly SemaphoreSlim running = new(1, 1);
    private readonly Lock gate = new();
    private CancellationTokenSource session = new();
    private ITimer? wakeUp;
    private int rerun;
    private bool started;

    public OutboxReplayer(Outbox outbox, IOutboxSender sender, TokenManager tokens, INetworkStatus network, TimeProvider clock)
    {
        this.outbox = outbox;
        this.sender = sender;
        this.tokens = tokens;
        this.network = network;
        this.clock = clock;

        // Always listen for session changes, started or not: a pass in flight must stop at once.
        tokens.SignedIn += OnSessionChanged;
        tokens.SignedOut += OnSessionChanged;
        tokens.SessionExpired += OnSessionChanged;
    }

    /// <summary>Raised after every pass with what it did.</summary>
    public event EventHandler<ReplayResult>? Replayed;

    /// <summary>Starts listening for connectivity and runs one pass.</summary>
    public void Start()
    {
        if (started)
        {
            return;
        }

        started = true;
        network.Changed += OnNetworkChanged;
        Kick();
    }

    /// <summary>Fire-and-forget pass; failures end up in the items themselves.</summary>
    public void Kick() => _ = ReplayAsync(CancellationToken.None);

    public async Task<ReplayResult> ReplayAsync(CancellationToken ct = default)
    {
        if (!await running.WaitAsync(0, ct).ConfigureAwait(false))
        {
            Interlocked.Exchange(ref rerun, 1);
            return ReplayResult.Nothing;
        }

        ReplayResult result;
        try
        {
            do
            {
                Interlocked.Exchange(ref rerun, 0);
                result = await PassAsync(ct).ConfigureAwait(false);
            }
            while (Interlocked.Exchange(ref rerun, 0) == 1 && !ct.IsCancellationRequested);
        }
        finally
        {
            running.Release();
        }

        Schedule(result.NextAttemptAt);
        Replayed?.Invoke(this, result);
        return result;
    }

    private async Task<ReplayResult> PassAsync(CancellationToken ct)
    {
        var binding = tokens.Bind();
        if (binding is null || !network.IsOnline)
        {
            return new ReplayResult(0, 0, binding is null ? 0 : await outbox.CountPendingAsync(binding.UserId, ct).ConfigureAwait(false),
                null, Skipped: true);
        }

        CancellationTokenSource pass;
        lock (gate)
        {
            pass = CancellationTokenSource.CreateLinkedTokenSource(ct, session.Token);
        }

        using (pass)
        {
            // A session change after Bind() but before the token was linked would be missed; check again.
            if (tokens.Generation != binding.Generation)
            {
                return await StoppedAsync(binding.UserId, 0, 0, null).ConfigureAwait(false);
            }

            try
            {
                return await DrainAsync(binding, pass.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (pass.IsCancellationRequested)
            {
                return await StoppedAsync(binding.UserId, 0, 0, null).ConfigureAwait(false);
            }
        }
    }

    private async Task<ReplayResult> DrainAsync(SessionBinding binding, CancellationToken ct)
    {
        var owner = binding.UserId;
        int sent = 0, rejected = 0;
        while (!ct.IsCancellationRequested)
        {
            var item = await outbox.PeekAsync(owner, ct).ConfigureAwait(false);
            if (item is null)
            {
                return new ReplayResult(sent, rejected, 0, null, Skipped: false);
            }

            var now = clock.GetUtcNow();
            if (item.NextAttemptAt > now)
            {
                // The head is still backing off; later items wait behind it to keep the order.
                return await StoppedAsync(owner, sent, rejected, item.NextAttemptAt).ConfigureAwait(false);
            }

            try
            {
                await sender.SendAsync(item, binding, ct).ConfigureAwait(false);
                await outbox.CompleteAsync(item.Seq, CancellationToken.None).ConfigureAwait(false);
                sent++;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                // Signed out or switched account mid-send: keep the item for its owner.
                return await StoppedAsync(owner, sent, rejected, null).ConfigureAwait(false);
            }
            catch (ApiException e) when (e.Kind == ApiErrorKind.SignInRequired)
            {
                // No session, or the session changed: keep the item; it goes out when its owner is back.
                return await StoppedAsync(owner, sent, rejected, null).ConfigureAwait(false);
            }
            catch (ApiException e) when (e.IsTransient)
            {
                var attempts = item.Attempts + 1;
                if (attempts >= OutboxLimits.MaxAttempts || now - item.ClientCreatedAt > OutboxLimits.MaxAge)
                {
                    await outbox.FailAsync(item.Seq, ErrorCodes.OutboxExhausted,
                        ErrorMessages.For(ErrorCodes.OutboxExhausted, null), CancellationToken.None).ConfigureAwait(false);
                    rejected++;
                    continue;
                }

                var next = now + Backoff.After(attempts);
                await outbox.DeferAsync(item.Seq, next, e.Code, e.Message, CancellationToken.None).ConfigureAwait(false);
                return await StoppedAsync(owner, sent, rejected, next).ConfigureAwait(false);
            }
            catch (ApiException e) when (e.Code == ErrorCodes.OutboxMalformed)
            {
                await outbox.FailAsync(item.Seq, e.Code, e.Message, CancellationToken.None).ConfigureAwait(false);
                rejected++;
            }
            catch (ApiException e)
            {
                await outbox.RejectAsync(item.Seq, e.Code, e.Message, CancellationToken.None).ConfigureAwait(false);
                rejected++;
            }
        }

        return await StoppedAsync(owner, sent, rejected, null).ConfigureAwait(false);
    }

    private async Task<ReplayResult> StoppedAsync(string owner, int sent, int rejected, DateTimeOffset? next) =>
        new(sent, rejected, await outbox.CountPendingAsync(owner, CancellationToken.None).ConfigureAwait(false), next, Skipped: false);

    private void Schedule(DateTimeOffset? at)
    {
        wakeUp?.Dispose();
        wakeUp = null;
        if (at is not { } when || !started)
        {
            return;
        }

        var delay = when - clock.GetUtcNow();
        wakeUp = clock.CreateTimer(_ => Kick(), null, delay < TimeSpan.Zero ? TimeSpan.Zero : delay, Timeout.InfiniteTimeSpan);
    }

    private void OnNetworkChanged(object? sender, bool online)
    {
        if (online)
        {
            Kick();
        }
    }

    private void OnSessionChanged(object? sender, EventArgs e)
    {
        CancellationTokenSource old;
        lock (gate)
        {
            old = session;
            session = new CancellationTokenSource();
        }

        // Not disposed: a pass may still hold a token linked to it; it is collected with the pass.
        old.Cancel();
        if (started)
        {
            Kick();
        }
    }

    public void Dispose()
    {
        network.Changed -= OnNetworkChanged;
        tokens.SignedIn -= OnSessionChanged;
        tokens.SignedOut -= OnSessionChanged;
        tokens.SessionExpired -= OnSessionChanged;
        wakeUp?.Dispose();
        lock (gate)
        {
            session.Dispose();
        }

        running.Dispose();
    }
}
