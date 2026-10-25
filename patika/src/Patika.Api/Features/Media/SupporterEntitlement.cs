using Microsoft.EntityFrameworkCore;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;

namespace Patika.Api.Features.Media;

/// <summary>Whether the user holds an active Patika Destekçi entitlement (phase 5 fills the table).</summary>
public interface ISupporterEntitlement
{
    Task<bool> IsSupporterAsync(Guid userId, DateTimeOffset now, CancellationToken cancellationToken);
}

public sealed class EfSupporterEntitlement(PatikaDbContext db) : ISupporterEntitlement
{
    public Task<bool> IsSupporterAsync(Guid userId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var utc = now.ToUniversalTime();
        return db.Subscriptions.AsNoTracking().AnyAsync(
            s => s.UserId == userId && s.Status == SubscriptionStatus.Active && s.ExpiresAt > utc, cancellationToken);
    }
}
