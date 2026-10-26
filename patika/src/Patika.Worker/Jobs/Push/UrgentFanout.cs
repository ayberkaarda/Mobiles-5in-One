using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Patika.Infrastructure.Persistence;

namespace Patika.Worker.Jobs.Push;

/// <summary>
/// A claimed urgent post. <see cref="Offset"/> recipients (in fan-out order) and <see cref="Notified"/> sends are
/// already behind it when it comes back from a deferral.
/// </summary>
public sealed record FanoutPost(Guid Id, Guid CreatedBy, double Latitude, double Longitude, string Category)
{
    public int Offset { get; init; }

    public int Notified { get; init; }
}

public sealed record FanoutRecipient(Guid DeviceId, Guid UserId, string Token);

public interface IUrgentFanoutStore
{
    /// <summary>
    /// Claims open posts not yet fanned out and created since <paramref name="createdSince"/>, plus deferred posts
    /// whose retry time has come and that were created since <paramref name="deferredSince"/>. Each claim is exclusive.
    /// </summary>
    Task<IReadOnlyList<FanoutPost>> ClaimAsync(
        DateTimeOffset now, DateTimeOffset createdSince, DateTimeOffset deferredSince, int batch, CancellationToken cancellationToken);

    /// <summary>
    /// Devices of opted-in, active users (author excluded) whose saved home area lies within
    /// min(their radius, <paramref name="maxRadiusMeters"/>) of the post; nearest first, skipping the first
    /// <paramref name="offset"/>, at most <paramref name="cap"/>.
    /// </summary>
    Task<IReadOnlyList<FanoutRecipient>> RecipientsAsync(
        FanoutPost post, int maxRadiusMeters, int cap, int offset, DateTimeOffset seenSince, CancellationToken cancellationToken);

    Task CompleteAsync(Guid postId, int notified, CancellationToken cancellationToken);

    /// <summary>Keeps the post pending: the rest of its recipients are retried at <paramref name="retryAt"/>.</summary>
    Task DeferAsync(Guid postId, int notified, int offset, DateTimeOffset retryAt, CancellationToken cancellationToken);

    Task RemoveDevicesAsync(IReadOnlyCollection<Guid> deviceIds, CancellationToken cancellationToken);
}

/// <summary>
/// Uses the <c>urgent_posts</c>, <c>device_tokens</c> and <c>users</c> tables with the
/// <c>urgent_posts.fanout_at</c>, <c>fanout_offset</c>, <c>fanout_retry_at</c> and <c>users.urgent_home</c> columns.
/// No live position is read or stored.
/// </summary>
public sealed class PgUrgentFanoutStore(PatikaDbContext db) : IUrgentFanoutStore
{
    public async Task<IReadOnlyList<FanoutPost>> ClaimAsync(
        DateTimeOffset now, DateTimeOffset createdSince, DateTimeOffset deferredSince, int batch, CancellationToken cancellationToken)
    {
        var utc = now.ToUniversalTime();
        var since = createdSince.ToUniversalTime();
        var deferred = deferredSince.ToUniversalTime();
        return await db.Database.SqlQuery<FanoutPost>($"""
            UPDATE urgent_posts AS p SET fanout_at = {utc}, fanout_retry_at = NULL
            WHERE p.id IN (
                SELECT id FROM urgent_posts
                WHERE hidden_at IS NULL AND state = 'Open'
                    AND ((fanout_at IS NULL AND created_at >= {since})
                        OR (fanout_retry_at <= {utc} AND created_at >= {deferred}))
                ORDER BY created_at LIMIT {batch} FOR UPDATE SKIP LOCKED)
            RETURNING p.id AS "Id", p.created_by AS "CreatedBy", ST_Y(p.location::geometry) AS "Latitude",
                ST_X(p.location::geometry) AS "Longitude", p.category AS "Category",
                p.fanout_offset AS "Offset", p.notified_count AS "Notified"
            """).ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<FanoutRecipient>> RecipientsAsync(
        FanoutPost post, int maxRadiusMeters, int cap, int offset, DateTimeOffset seenSince, CancellationToken cancellationToken)
    {
        var since = seenSince.ToUniversalTime();
        return await db.Database.SqlQuery<FanoutRecipient>($"""
            SELECT d.id AS "DeviceId", d.user_id AS "UserId", d.token AS "Token"
            FROM device_tokens AS d
            JOIN users AS u ON u.id = d.user_id,
                (SELECT ST_SetSRID(ST_MakePoint({post.Longitude}, {post.Latitude}), 4326)::geography AS origin) AS o
            WHERE u.urgent_opt_in AND u.deactivated_at IS NULL AND u.urgent_home IS NOT NULL
                AND u.id <> {post.CreatedBy}
                AND d.last_seen_at >= {since}
                AND ST_DWithin(u.urgent_home, o.origin, LEAST(u.urgent_radius_m, {maxRadiusMeters})::double precision)
            ORDER BY ST_Distance(u.urgent_home, o.origin), d.last_seen_at DESC, d.id
            OFFSET {offset} LIMIT {cap}
            """).ToListAsync(cancellationToken);
    }

    public async Task CompleteAsync(Guid postId, int notified, CancellationToken cancellationToken) =>
        await db.Database.ExecuteSqlAsync($"""
            UPDATE urgent_posts SET notified_count = {notified}, fanout_retry_at = NULL, updated_at = now() WHERE id = {postId}
            """, cancellationToken);

    public async Task DeferAsync(Guid postId, int notified, int offset, DateTimeOffset retryAt, CancellationToken cancellationToken)
    {
        var retry = retryAt.ToUniversalTime();
        await db.Database.ExecuteSqlAsync($"""
            UPDATE urgent_posts SET notified_count = {notified}, fanout_offset = {offset}, fanout_retry_at = {retry},
                updated_at = now()
            WHERE id = {postId}
            """, cancellationToken);
    }

    public async Task RemoveDevicesAsync(IReadOnlyCollection<Guid> deviceIds, CancellationToken cancellationToken)
    {
        if (deviceIds.Count == 0)
        {
            return;
        }

        var ids = deviceIds.ToList();
        await db.DeviceTokens.Where(d => ids.Contains(d.Id)).ExecuteDeleteAsync(cancellationToken);
    }
}

public sealed record FanoutSummary(Guid PostId, int Recipients, int Granted, int Sent, int InvalidTokens)
{
    /// <summary>Set when a budget granted less than needed and the rest waits for the next window.</summary>
    public DateTimeOffset? DeferredUntil { get; init; }
}

/// <summary>
/// <c>urgent.fanout</c>: claim new urgent posts, compute recipients server-side, reserve budget from
/// <see cref="PushCostGuard"/> (author budget, then the urgent counter), send, prune dead tokens and record the
/// notified count. When a budget grants less than needed, the post is not marked complete: the remaining
/// recipients are deferred to the next local day and the post is claimed again then.
/// </summary>
public sealed class UrgentFanout(
    IUrgentFanoutStore store, IPushSender sender, PushCostGuard guard, IOptions<PushSettings> options, TimeProvider clock,
    ILogger<UrgentFanout> logger)
{
    public const string Title = "Acil yardım gerekiyor";
    public const string Body = "Yakınında yardıma ihtiyacı olan bir hayvan var.";
    public const int ClaimBatch = 10;
    public const int MaxDevicesPerPost = 500;

    public async Task<IReadOnlyList<FanoutSummary>> RunOnceAsync(CancellationToken cancellationToken)
    {
        var settings = options.Value;
        var now = clock.GetUtcNow();
        var posts = await store.ClaimAsync(now, now.AddMinutes(-settings.FanoutWindowMinutes),
            now.AddHours(-Math.Max(0, settings.DeferredFanoutHours)), ClaimBatch, cancellationToken);
        var summaries = new List<FanoutSummary>(posts.Count);
        foreach (var post in posts)
        {
            summaries.Add(await FanOutAsync(post, settings, now, cancellationToken));
        }

        return summaries;
    }

    private async Task<FanoutSummary> FanOutAsync(FanoutPost post, PushSettings settings, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var cap = Math.Min(settings.MaxDevicesPerPost, MaxDevicesPerPost);
        var offset = Math.Clamp(post.Offset, 0, cap);
        var radius = Math.Min(settings.MaxRadiusMeters, 2000);
        var candidates = await store.RecipientsAsync(post, radius, cap - offset, offset, now.AddDays(-settings.StaleDeviceDays), cancellationToken);
        var window = candidates.Take(cap - offset).ToList();
        var recipients = window
            .DistinctBy(r => r.Token, StringComparer.Ordinal)
            .Where(r => r.UserId != post.CreatedBy)
            .ToList();
        var grant = await guard.ReserveUrgentAsync(post.CreatedBy, recipients.Count, cancellationToken);
        var targets = recipients.Take(grant.Granted).ToList();
        var data = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["type"] = "urgent",
            ["urgentId"] = post.Id.ToString("D"),
            ["category"] = post.Category,
        };

        var invalid = new ConcurrentBag<Guid>();
        var sent = 0;
        await Parallel.ForEachAsync(
            targets,
            new ParallelOptions { MaxDegreeOfParallelism = Math.Max(1, settings.SendParallelism), CancellationToken = cancellationToken },
            async (recipient, ct) =>
            {
                var outcome = await sender.SendAsync(new PushMessage(recipient.Token, Title, Body, data, Critical: true), ct);
                if (outcome == PushOutcome.Sent)
                {
                    Interlocked.Increment(ref sent);
                }
                else if (outcome == PushOutcome.InvalidToken)
                {
                    invalid.Add(recipient.DeviceId);
                }
            });

        await guard.ReleaseUrgentAsync(post.CreatedBy, grant.Granted - sent, cancellationToken);
        await store.RemoveDevicesAsync([.. invalid], cancellationToken);
        var notified = Math.Min(MaxDevicesPerPost, post.Notified + sent);
        if (grant.Granted >= recipients.Count)
        {
            await store.CompleteAsync(post.Id, notified, cancellationToken);
            return new FanoutSummary(post.Id, recipients.Count, grant.Granted, sent, invalid.Count);
        }

        // Everything before the first device that got no grant is done; the rest waits for the next window.
        var handled = offset + window.IndexOf(recipients[grant.Granted]);
        var retryAt = PushCostGuard.NextDay(now);
        await store.DeferAsync(post.Id, notified, handled, retryAt, cancellationToken);
        logger.LogWarning(
            "urgent.fanout capped by cost.guard ({Limit}): {Granted} of {Recipients} devices now, the rest deferred to {RetryAt}",
            grant.LimitedBy, grant.Granted, recipients.Count, retryAt);
        return new FanoutSummary(post.Id, recipients.Count, grant.Granted, sent, invalid.Count) { DeferredUntil = retryAt };
    }
}
