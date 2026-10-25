using Microsoft.EntityFrameworkCore;
using Patika.Contracts.Auth;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;

namespace Patika.Api.Features.Account;

/// <summary>Contribution counts behind <c>GET /v1/me</c>.</summary>
public sealed record AccountStats(int FeedingCount, int SightingCount, int AdoptionsHelped, DateTimeOffset JoinedAt)
{
    /// <summary>The fixed badge set, in a stable order, derived from the counts only.</summary>
    public IReadOnlyList<string> Badges()
    {
        var badges = new List<string>(6);
        if (FeedingCount >= 1)
        {
            badges.Add(MeBadges.FirstFeeding);
        }

        if (FeedingCount >= 10)
        {
            badges.Add(MeBadges.Feedings10);
        }

        if (FeedingCount >= 50)
        {
            badges.Add(MeBadges.Feedings50);
        }

        if (FeedingCount >= 100)
        {
            badges.Add(MeBadges.Feedings100);
        }

        if (SightingCount >= 1)
        {
            badges.Add(MeBadges.FirstSighting);
        }

        if (AdoptionsHelped >= 1)
        {
            badges.Add(MeBadges.FirstAdoptionHelped);
        }

        return badges;
    }
}

public interface IAccountStatsReader
{
    /// <summary>Null when the account does not exist.</summary>
    Task<AccountStats?> ReadAsync(Guid userId, CancellationToken cancellationToken);
}

/// <summary>
/// Counts the user's feedings and sightings, and adoption posts they created whose animal is now
/// adopted. One round trip; every count is a LINQ subquery (parameterized).
/// </summary>
public sealed class EfAccountStatsReader(PatikaDbContext db) : IAccountStatsReader
{
    public async Task<AccountStats?> ReadAsync(Guid userId, CancellationToken cancellationToken)
    {
        var row = await db.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => new
            {
                u.CreatedAt,
                Feedings = db.Feedings.Count(f => f.UserId == userId),
                Sightings = db.Sightings.Count(s => s.UserId == userId),
                Adoptions = db.AdoptionPosts.Count(p => p.CreatedBy == userId
                    && db.Animals.Any(a => a.Id == p.AnimalId && a.Status == AnimalStatus.Adopted)),
            })
            .SingleOrDefaultAsync(cancellationToken);
        return row is null ? null : new AccountStats(row.Feedings, row.Sightings, row.Adoptions, row.CreatedAt);
    }
}
