using Microsoft.EntityFrameworkCore;
using Npgsql;
using Patika.Api.Features.Auth;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;

namespace Patika.Api.Features.Account;

/// <summary>Outcome of a deletion request: when the hard delete may run, and whether this call created it.</summary>
public sealed record DeletionSchedule(Guid RequestId, DateTimeOffset ExecuteAfter, bool Created);

public static class AccountAuditActions
{
    public const string DeletionRequested = "account.deletion_requested";
    public const string TargetUser = "user";
}

public interface IAccountDeletionStore
{
    /// <summary>
    /// In one transaction: deactivates the account (new session version), records the deletion request (execute after
    /// <paramref name="grace"/>), revokes every refresh token, deletes device tokens and follows,
    /// closes the user's open adoption posts and writes an audit row without personal data.
    /// Idempotent: a second call returns the pending schedule with <see cref="DeletionSchedule.Created"/> false.
    /// Returns null when the account does not exist or is deactivated for another reason.
    /// </summary>
    Task<DeletionSchedule?> RequestDeletionAsync(Guid userId, DateTimeOffset now, TimeSpan grace, CancellationToken cancellationToken);
}

/// <summary>EF Core implementation; every statement is LINQ (parameterized) or interpolated SQL.</summary>
public sealed class EfAccountDeletionStore(PatikaDbContext db) : IAccountDeletionStore
{
    private const string UniqueViolation = "23505";

    public async Task<DeletionSchedule?> RequestDeletionAsync(
        Guid userId, DateTimeOffset now, TimeSpan grace, CancellationToken cancellationToken)
    {
        try
        {
            return await RequestOnceAsync(userId, now, grace, cancellationToken);
        }
        catch (DbUpdateException exception) when (exception.InnerException is PostgresException { SqlState: UniqueViolation })
        {
            // A concurrent request won the filtered unique index on pending deletion requests.
            db.ChangeTracker.Clear();
            return await FindPendingAsync(userId, cancellationToken);
        }
    }

    private async Task<DeletionSchedule?> RequestOnceAsync(
        Guid userId, DateTimeOffset now, TimeSpan grace, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var deactivated = await db.Users
            .Where(u => u.Id == userId && u.DeactivatedAt == null)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(u => u.DeactivatedAt, now)
                .SetProperty(u => u.UpdatedAt, now), cancellationToken);
        if (deactivated != 1)
        {
            await transaction.RollbackAsync(cancellationToken);
            return await FindPendingAsync(userId, cancellationToken);
        }

        var request = new DeletionRequest
        {
            UserId = userId,
            RequestedAt = now,
            ExecuteAfter = now + grace,
        };
        db.DeletionRequests.Add(request);
        db.AuditLogs.Add(new AuditLog
        {
            ActorId = userId,
            Action = AccountAuditActions.DeletionRequested,
            TargetType = AccountAuditActions.TargetUser,
            TargetId = userId,
        });
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();

        await new EfAuthStore(db).RevokeAllForUserAsync(userId, now, cancellationToken);
        await EfAuthStore.BumpSessionVersionAsync(db, userId, cancellationToken);
        await db.DeviceTokens.Where(t => t.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await db.Follows.Where(f => f.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await db.AdoptionPosts
            .Where(p => p.CreatedBy == userId
                && (p.State == AdoptionPostState.Pending || p.State == AdoptionPostState.Published))
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(p => p.State, AdoptionPostState.Closed)
                .SetProperty(p => p.ClosesAt, p => p.ClosesAt < now ? p.ClosesAt : now)
                .SetProperty(p => p.UpdatedAt, now), cancellationToken);

        await transaction.CommitAsync(cancellationToken);
        return new DeletionSchedule(request.Id, request.ExecuteAfter, Created: true);
    }

    private async Task<DeletionSchedule?> FindPendingAsync(Guid userId, CancellationToken cancellationToken)
    {
        var pending = await db.DeletionRequests.AsNoTracking()
            .Where(r => r.UserId == userId && r.CompletedAt == null && r.CancelledAt == null)
            .Select(r => new { r.Id, r.ExecuteAfter })
            .SingleOrDefaultAsync(cancellationToken);
        return pending is null ? null : new DeletionSchedule(pending.Id, pending.ExecuteAfter, Created: false);
    }
}
