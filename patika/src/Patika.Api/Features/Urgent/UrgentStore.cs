using Microsoft.EntityFrameworkCore;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;

namespace Patika.Api.Features.Urgent;

public sealed record UrgentPostRecord(
    Guid Id,
    GeoPoint Location,
    UrgentCategory Category,
    string Description,
    string PhotoKey,
    UrgentPostState State,
    Guid CreatedBy,
    int NotifiedCount,
    DateTimeOffset CreatedAt,
    int? DistanceMeters = null);

public interface IUrgentStore
{
    /// <summary>
    /// Inserts the post when its author has fewer than <paramref name="dailyCap"/> posts since
    /// <paramref name="dayStart"/>; false (and nothing stored) otherwise. Atomic per author.
    /// </summary>
    Task<bool> TryCreateAsync(UrgentPostRecord post, DateTimeOffset dayStart, int dailyCap, CancellationToken cancellationToken);

    Task<UrgentPostRecord?> FindAsync(Guid id, CancellationToken cancellationToken);

    Task UpdateStateAsync(Guid id, UrgentPostState state, CancellationToken cancellationToken);

    /// <summary>Open posts within <paramref name="radiusMeters"/>, nearest first.</summary>
    Task<IReadOnlyList<UrgentPostRecord>> NearAsync(GeoPoint center, int radiusMeters, int limit, CancellationToken cancellationToken);
}

/// <summary>EF store over the existing <c>urgent_posts</c> table; spatial reads use interpolated (parameterized) SQL.</summary>
public sealed class EfUrgentStore(PatikaDbContext db) : IUrgentStore
{
    public async Task<bool> TryCreateAsync(
        UrgentPostRecord post, DateTimeOffset dayStart, int dailyCap, CancellationToken cancellationToken)
    {
        var since = dayStart.ToUniversalTime();
        var lockKey = "urgent:" + post.CreatedBy.ToString("D");
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await db.Database.ExecuteSqlAsync($"SELECT pg_advisory_xact_lock(hashtextextended({lockKey}, 0))", cancellationToken);
        var today = await db.UrgentPosts.IgnoreQueryFilters().CountAsync(p => p.CreatedBy == post.CreatedBy && p.CreatedAt >= since, cancellationToken);
        if (today >= dailyCap)
        {
            return false;
        }

        db.UrgentPosts.Add(new UrgentPost
        {
            Id = post.Id,
            Location = post.Location,
            Category = post.Category,
            Description = post.Description,
            PhotoKey = post.PhotoKey,
            State = post.State,
            CreatedBy = post.CreatedBy,
        });
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    public async Task<UrgentPostRecord?> FindAsync(Guid id, CancellationToken cancellationToken)
    {
        var post = await db.UrgentPosts.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, cancellationToken);
        return post is null ? null : ToRecord(post);
    }

    public Task UpdateStateAsync(Guid id, UrgentPostState state, CancellationToken cancellationToken) =>
        db.UrgentPosts.Where(p => p.Id == id).ExecuteUpdateAsync(
            set => set.SetProperty(p => p.State, state).SetProperty(p => p.UpdatedAt, DateTimeOffset.UtcNow),
            cancellationToken);

    public async Task<IReadOnlyList<UrgentPostRecord>> NearAsync(
        GeoPoint center, int radiusMeters, int limit, CancellationToken cancellationToken)
    {
        var open = nameof(UrgentPostState.Open);
        var rows = await db.Database.SqlQuery<NearRow>($"""
            SELECT id AS "Id", ST_Distance(location, origin)::int AS "DistanceMeters"
            FROM urgent_posts, (SELECT ST_SetSRID(ST_MakePoint({center.Longitude}, {center.Latitude}), 4326)::geography AS origin) AS o
            WHERE hidden_at IS NULL AND state = {open} AND ST_DWithin(location, origin, {radiusMeters})
            ORDER BY ST_Distance(location, origin), id
            LIMIT {limit}
            """).ToListAsync(cancellationToken);
        if (rows.Count == 0)
        {
            return [];
        }

        var ids = rows.Select(r => r.Id).ToList();
        var posts = await db.UrgentPosts.AsNoTracking().Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id, cancellationToken);
        return [.. rows.Where(r => posts.ContainsKey(r.Id)).Select(r => ToRecord(posts[r.Id]) with { DistanceMeters = r.DistanceMeters })];
    }

    private static UrgentPostRecord ToRecord(UrgentPost p) =>
        new(p.Id, p.Location, p.Category, p.Description, p.PhotoKey, p.State, p.CreatedBy, p.NotifiedCount, p.CreatedAt);

    private sealed record NearRow(Guid Id, int DistanceMeters);
}
