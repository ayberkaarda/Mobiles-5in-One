using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Patika.Infrastructure.Persistence;

namespace Patika.Worker.Jobs.Push;

public sealed record FanoutPost(Guid Id, Guid CreatedBy, double Latitude, double Longitude, string Category);

public sealed record FanoutRecipient(Guid DeviceId, Guid UserId, string Token);

public interface IUrgentFanoutStore
{
    /// <summary>Claims open posts not yet fanned out (each post is claimed exactly once).</summary>
    Task<IReadOnlyList<FanoutPost>> ClaimAsync(DateTimeOffset now, DateTimeOffset createdSince, int batch, CancellationToken cancellationToken);

    /// <summary>
    /// Devices of opted-in, active users (author excluded) whose saved home area lies within
    /// min(their radius, <paramref name="maxRadiusMeters"/>) of the post; nearest first, at most <paramref name="cap"/>.
    /// </summary>
    Task<IReadOnlyList<FanoutRecipient>> RecipientsAsync(
        FanoutPost post, int maxRadiusMeters, int cap, DateTimeOffset seenSince, CancellationToken cancellationToken);

    Task CompleteAsync(Guid postId, int notified, CancellationToken cancellationToken);

    Task RemoveDevicesAsync(IReadOnlyCollection<Guid> deviceIds, CancellationToken cancellationToken);
}

/// <summary>
/// Uses the existing <c>urgent_posts</c>, <c>device_tokens</c> and <c>users</c> tables plus the proposed
/// <c>urgent_posts.fanout_at</c> and <c>users.urgent_home</c> columns. No live position is read or stored.
/// </summary>
public sealed class PgUrgentFanoutStore(PatikaDbContext db) : IUrgentFanoutStore
{
    public async Task<IReadOnlyList<FanoutPost>> ClaimAsync(
        DateTimeOffset now, DateTimeOffset createdSince, int batch, CancellationToken cancellationToken)
    {
        var utc = now.ToUniversalTime();
        var since = createdSince.ToUniversalTime();
        return await db.Database.SqlQuery<FanoutPost>($"""
            UPDATE urgent_posts AS p SET fanout_at = {utc}
            WHERE p.id IN (
                SELECT id FROM urgent_posts
                WHERE fanout_at IS NULL AND state = 'Open' AND created_at >= {since}
                ORDER BY created_at LIMIT {batch} FOR UPDATE SKIP LOCKED)
            RETURNING p.id AS "Id", p.created_by AS "CreatedBy", ST_Y(p.location::geometry) AS "Latitude",
                ST_X(p.location::geometry) AS "Longitude", p.category AS "Category"
            """).ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<FanoutRecipient>> RecipientsAsync(
        FanoutPost post, int maxRadiusMeters, int cap, DateTimeOffset seenSince, CancellationToken cancellationToken)
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
            LIMIT {cap}
            """).ToListAsync(cancellationToken);
    }

    public async Task CompleteAsync(Guid postId, int notified, CancellationToken cancellationToken) =>
        await db.Database.ExecuteSqlAsync($"""
            UPDATE urgent_posts SET notified_count = {notified}, updated_at = now() WHERE id = {postId}
            """, cancellationToken);

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

public sealed record FanoutSummary(Guid PostId, int Recipients, int Granted, int Sent, int InvalidTokens);

/// <summary>
/// <c>urgent.fanout</c>: claim new urgent posts, compute recipients server-side, reserve budget from
/// <see cref="PushCostGuard"/>, send, prune dead tokens and record the notified count.
/// </summary>
public sealed class UrgentFanout(
    IUrgentFanoutStore store, IPushSender sender, PushCostGuard guard, IOptions<PushSettings> options, TimeProvider clock,
    ILogger<UrgentFanout> logger)
{
    public const string Title = "Acil yardım gerekiyor";
    public const string Body = "Yakınında yardıma ihtiyacı olan bir hayvan var.";
    public const int ClaimBatch = 10;

    public async Task<IReadOnlyList<FanoutSummary>> RunOnceAsync(CancellationToken cancellationToken)
    {
        var settings = options.Value;
        var now = clock.GetUtcNow();
        var posts = await store.ClaimAsync(now, now.AddMinutes(-settings.FanoutWindowMinutes), ClaimBatch, cancellationToken);
        var summaries = new List<FanoutSummary>(posts.Count);
        foreach (var post in posts)
        {
            summaries.Add(await FanOutAsync(post, settings, now, cancellationToken));
        }

        return summaries;
    }

    private async Task<FanoutSummary> FanOutAsync(FanoutPost post, PushSettings settings, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var cap = Math.Min(settings.MaxDevicesPerPost, 500);
        var radius = Math.Min(settings.MaxRadiusMeters, 2000);
        var recipients = (await store.RecipientsAsync(post, radius, cap, now.AddDays(-settings.StaleDeviceDays), cancellationToken))
            .DistinctBy(r => r.Token, StringComparer.Ordinal)
            .Where(r => r.UserId != post.CreatedBy)
            .Take(cap)
            .ToList();
        var granted = await guard.ReserveAsync(recipients.Count, critical: true, cancellationToken);
        var targets = recipients.Take(granted).ToList();
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

        await guard.ReleaseAsync(granted - sent, cancellationToken);
        await store.RemoveDevicesAsync([.. invalid], cancellationToken);
        await store.CompleteAsync(post.Id, sent, cancellationToken);
        if (granted < recipients.Count)
        {
            logger.LogWarning("urgent.fanout capped by cost.guard: {Granted} of {Recipients} devices", granted, recipients.Count);
        }

        return new FanoutSummary(post.Id, recipients.Count, granted, sent, invalid.Count);
    }
}
