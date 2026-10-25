using System.Collections.Concurrent;
using Patika.App.Core.Api;
using Patika.App.Core.Offline;

namespace Patika.App.Core.Map;

/// <summary>
/// How long until "Beslendi" opens again for a station (canvas "Bekleme"). The API allows one feeding per
/// person and station every 30 minutes, counted from when the server received it. The book keeps the
/// server's own answers: a sent feeding starts 30 minutes, a refused one (<c>feeding_cooldown</c>) waits
/// <c>retryAfterSeconds</c>. Both count down on the monotonic clock, so changing or skewed phone time does
/// not shorten or stretch the wait. Without an entry (after a restart) the latest own feeding in the station
/// detail is measured against the server's clock (<see cref="ServerTime"/>), the phone's only as a last
/// resort. In memory only, per account, wiped at every session change.
/// </summary>
public sealed class CooldownBook
{
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(30);

    private readonly ConcurrentDictionary<(string Owner, Guid Station), (long Start, TimeSpan Wait)> entries = new();
    private readonly TimeProvider clock;
    private readonly ServerTime? server;

    public CooldownBook(TokenManager tokens, TimeProvider clock, ServerTime? server = null)
    {
        this.clock = clock;
        this.server = server;
        tokens.SignedIn += (_, _) => Clear();
        tokens.SignedOut += (_, _) => Clear();
        tokens.SessionExpired += (_, _) => Clear();
    }

    /// <summary>Raised with the station id after an entry changes.</summary>
    public event EventHandler<Guid>? Changed;

    public void RecordSent(string owner, Guid station) => Set(owner, station, Window);

    public void RecordRefused(string owner, Guid station, int? retryAfterSeconds) =>
        Set(owner, station, retryAfterSeconds is { } seconds ? TimeSpan.FromSeconds(seconds) : Window);

    /// <summary>Time left before the caller may feed <paramref name="station"/> again, or null when they may now.</summary>
    public TimeSpan? Remaining(string? owner, Guid station, StationDetail? detail = null)
    {
        if (owner is null)
        {
            return null;
        }

        TimeSpan? left = null;
        if (entries.TryGetValue((owner, station), out var entry))
        {
            left = entry.Wait - clock.GetElapsedTime(entry.Start);
        }
        else if (detail is not null && detail.Station.Id == station
            && detail.Feedings.Where(f => f.IsMine).Select(f => (DateTimeOffset?)f.At).Max() is { } mine)
        {
            left = mine + Window - (server?.Now() ?? clock.GetUtcNow());
        }

        return left > TimeSpan.Zero ? left : null;
    }

    /// <summary>For display only: when it opens on the phone's clock.</summary>
    public DateTimeOffset? OpensAt(string? owner, Guid station, StationDetail? detail = null) =>
        Remaining(owner, station, detail) is { } left ? clock.GetUtcNow() + left : null;

    public void Clear() => entries.Clear();

    private void Set(string owner, Guid station, TimeSpan wait)
    {
        entries[(owner, station)] = (clock.GetTimestamp(), wait);
        Changed?.Invoke(this, station);
    }
}

/// <summary>
/// Wraps the outbox sender so every feeding the server takes or refuses for the cooldown lands in the
/// <see cref="CooldownBook"/>, whether it went out at the tap or later from the queue.
/// </summary>
public sealed class CooldownAwareSender(IOutboxSender inner, CooldownBook book) : IOutboxSender
{
    public async Task SendAsync(OutboxItem item, SessionBinding session, CancellationToken ct)
    {
        var feeding = item.Kind == OutboxKinds.Feeding && Guid.TryParse(item.TargetId, out _);
        try
        {
            await inner.SendAsync(item, session, ct).ConfigureAwait(false);
            if (feeding)
            {
                book.RecordSent(session.UserId, Guid.Parse(item.TargetId));
            }
        }
        catch (ApiException e) when (feeding && e.Code == ErrorCodes.FeedingCooldown)
        {
            book.RecordRefused(session.UserId, Guid.Parse(item.TargetId), e.RetryAfterSeconds);
            throw;
        }
    }
}

/// <summary>What a Beslendi tap led to.</summary>
public enum FeedOutcome
{
    /// <summary>The server has it.</summary>
    Sent,

    /// <summary>Saved on the phone; it goes out when the connection is back.</summary>
    Queued,

    /// <summary>
    /// A Beslendi for this station is still waiting on the phone, so no second record was made. Not the
    /// server's cooldown: it lasts until that record is sent or set aside, whatever the clock says.
    /// </summary>
    AlreadyQueued,

    /// <summary>Inside the server's 30 minutes; <see cref="FeedDecision.Remaining"/> says how long.</summary>
    Cooldown,
}

public sealed record FeedDecision(FeedOutcome Outcome, TimeSpan Remaining, DateTimeOffset? RecordedAt);

/// <summary>
/// The Beslendi decision, without any screen: a record still queued for the station blocks a duplicate;
/// a known server cooldown answers without a request; otherwise the record goes through the outbox and the
/// server's answer decides. The app turns the decision into the Beslendi or Bekleme screen.
/// </summary>
public sealed class FeedPlanner(FieldActions actions, Outbox outbox, CooldownBook cooldowns, TokenManager tokens, TimeProvider clock)
{
    public async Task<FeedDecision> FeedAsync(StationDetail detail, CancellationToken ct = default)
    {
        var station = detail.Station.Id;
        var owner = tokens.UserId;
        if (owner is not null)
        {
            var target = station.ToString();
            var waiting = (await outbox.ListAsync(owner, ct).ConfigureAwait(false))
                .LastOrDefault(i => i.Kind == OutboxKinds.Feeding && i.State == OutboxState.Pending && i.TargetId == target);
            if (waiting is not null)
            {
                return new FeedDecision(FeedOutcome.AlreadyQueued, Window, waiting.ClientCreatedAt);
            }
        }

        if (cooldowns.Remaining(owner, station, detail) is { } left)
        {
            return new FeedDecision(FeedOutcome.Cooldown, left, null);
        }

        var result = await actions.FeedAsync(station, new FeedingDraft(), ct).ConfigureAwait(false);
        return result.Outcome switch
        {
            SubmitOutcome.Sent => new FeedDecision(FeedOutcome.Sent, cooldowns.Remaining(owner, station) ?? Window, clock.GetUtcNow()),
            SubmitOutcome.Queued => new FeedDecision(FeedOutcome.Queued, Window, result.Item.ClientCreatedAt),
            SubmitOutcome.Rejected when result.ErrorCode == ErrorCodes.FeedingCooldown =>
                new FeedDecision(FeedOutcome.Cooldown, cooldowns.Remaining(owner, station) ?? Window, null),
            _ => throw new ApiException(ApiErrorKind.Client, result.Message ?? ErrorMessages.Unknown, code: result.ErrorCode),
        };
    }

    private static TimeSpan Window => CooldownBook.Window;
}
