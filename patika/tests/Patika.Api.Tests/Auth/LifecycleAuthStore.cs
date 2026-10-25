using Patika.Api.Features.Account;
using Patika.Api.Features.Auth;
using Patika.Api.Tests.Infrastructure;

namespace Patika.Api.Tests.Auth;

/// <summary>
/// Wraps the shared <see cref="InMemoryAuthStore"/> and adds password reset tokens and deletion
/// requests with the same semantics as the EF stores (single use, expiry, grace period, full revocation).
/// </summary>
public sealed class LifecycleAuthStore(InMemoryAuthStore inner) : IAuthStore, IAccountDeletionStore
{
    private readonly Lock gate = new();
    private readonly Dictionary<Guid, (EmailTokenRecord Token, DateTimeOffset? UsedAt)> resetTokens = [];
    private readonly Dictionary<Guid, Deletion> deletions = [];

    public InMemoryAuthStore Inner => inner;

    public int ResetTokenCount
    {
        get
        {
            lock (gate)
            {
                return resetTokens.Count;
            }
        }
    }

    public Deletion? DeletionFor(Guid userId)
    {
        lock (gate)
        {
            return deletions.GetValueOrDefault(userId);
        }
    }

    public void ExpireResetTokens()
    {
        lock (gate)
        {
            foreach (var (id, entry) in resetTokens.ToArray())
            {
                resetTokens[id] = (entry.Token with { ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(-1) }, entry.UsedAt);
            }
        }
    }

    public void EndGracePeriod(Guid userId)
    {
        lock (gate)
        {
            deletions[userId] = deletions[userId] with { ExecuteAfter = DateTimeOffset.UtcNow.AddSeconds(-1) };
        }
    }

    public Task<AuthUser?> FindUserByIdAsync(Guid userId, CancellationToken cancellationToken) =>
        inner.FindUserByIdAsync(userId, cancellationToken);

    public Task<AuthUser?> FindUserByEmailAsync(string normalizedEmail, CancellationToken cancellationToken) =>
        inner.FindUserByEmailAsync(normalizedEmail, cancellationToken);

    public Task<AuthUser?> FindUserByExternalLoginAsync(ExternalLoginKey login, CancellationToken cancellationToken) =>
        inner.FindUserByExternalLoginAsync(login, cancellationToken);

    public Task<bool> TryCreateUserAsync(
        AuthUser user, ExternalLoginKey? login, EmailTokenRecord? emailToken, CancellationToken cancellationToken) =>
        inner.TryCreateUserAsync(user, login, emailToken, cancellationToken);

    public Task<Guid?> TryConsumeEmailTokenAsync(
        byte[] tokenHash, string purpose, DateTimeOffset now, CancellationToken cancellationToken) =>
        inner.TryConsumeEmailTokenAsync(tokenHash, purpose, now, cancellationToken);

    public Task<bool> TryLinkExternalLoginAsync(Guid userId, ExternalLoginKey login, CancellationToken cancellationToken) =>
        inner.TryLinkExternalLoginAsync(userId, login, cancellationToken);

    public Task AddRefreshTokenAsync(RefreshTokenRecord token, CancellationToken cancellationToken) =>
        inner.AddRefreshTokenAsync(token, cancellationToken);

    public Task<RefreshTokenRecord?> FindRefreshTokenAsync(byte[] tokenHash, CancellationToken cancellationToken) =>
        inner.FindRefreshTokenAsync(tokenHash, cancellationToken);

    public Task<bool> TryRotateRefreshTokenAsync(
        Guid currentId, RefreshTokenRecord replacement, DateTimeOffset now, CancellationToken cancellationToken) =>
        inner.TryRotateRefreshTokenAsync(currentId, replacement, now, cancellationToken);

    public Task<int> RevokeFamilyAsync(Guid familyId, DateTimeOffset now, CancellationToken cancellationToken) =>
        inner.RevokeFamilyAsync(familyId, now, cancellationToken);

    public Task StoreEmailTokenAsync(EmailTokenRecord token, CancellationToken cancellationToken)
    {
        lock (gate)
        {
            foreach (var (id, entry) in resetTokens.ToArray())
            {
                if (entry.Token.UserId == token.UserId && entry.Token.Purpose == token.Purpose && entry.UsedAt is null)
                {
                    resetTokens.Remove(id);
                }
            }

            resetTokens[token.Id] = (token, null);
        }

        return Task.CompletedTask;
    }

    public async Task<Guid?> TryResetPasswordAsync(
        byte[] tokenHash, string newPasswordHash, DateTimeOffset now, CancellationToken cancellationToken)
    {
        Guid userId;
        lock (gate)
        {
            var match = resetTokens.Values.FirstOrDefault(e => e.Token.TokenHash.AsSpan().SequenceEqual(tokenHash)
                && e.Token.Purpose == EmailTokenRecord.PasswordReset);
            if (match.Token is null || match.UsedAt is not null || match.Token.ExpiresAt <= now)
            {
                return null;
            }

            userId = match.Token.UserId;
            if (inner.Users.SingleOrDefault(u => u.Id == userId) is not { IsActive: true })
            {
                return null;
            }

            resetTokens[match.Token.Id] = (match.Token, now);
            foreach (var (id, entry) in resetTokens.ToArray())
            {
                if (entry.Token.UserId == userId && entry.UsedAt is null)
                {
                    resetTokens.Remove(id);
                }
            }

            inner.Update(userId, u => u with
            {
                PasswordHash = newPasswordHash,
                EmailVerifiedAt = u.EmailVerifiedAt ?? now,
                SessionVersion = u.SessionVersion + 1,
            });
        }

        await RevokeAllAsync(userId, now, cancellationToken);
        return userId;
    }

    public Task<bool> TryCancelPendingDeletionAsync(Guid userId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        lock (gate)
        {
            if (!deletions.TryGetValue(userId, out var deletion) || deletion.CancelledAt is not null
                || deletion.ExecuteAfter <= now)
            {
                return Task.FromResult(false);
            }

            deletions[userId] = deletion with { CancelledAt = now };
            inner.Update(userId, u => u with { DeactivatedAt = null, SessionVersion = u.SessionVersion + 1 });
            return Task.FromResult(true);
        }
    }

    public async Task<DeletionSchedule?> RequestDeletionAsync(
        Guid userId, DateTimeOffset now, TimeSpan grace, CancellationToken cancellationToken)
    {
        DeletionSchedule schedule;
        lock (gate)
        {
            var user = inner.Users.SingleOrDefault(u => u.Id == userId);
            if (user is null)
            {
                return null;
            }

            if (!user.IsActive)
            {
                return deletions.TryGetValue(userId, out var pending) && pending.CancelledAt is null
                    ? new DeletionSchedule(pending.Id, pending.ExecuteAfter, Created: false)
                    : null;
            }

            var deletion = new Deletion(Guid.CreateVersion7(), now, now + grace, null);
            deletions[userId] = deletion;
            inner.Update(userId, u => u with { DeactivatedAt = now, SessionVersion = u.SessionVersion + 1 });
            schedule = new DeletionSchedule(deletion.Id, deletion.ExecuteAfter, Created: true);
        }

        await RevokeAllAsync(userId, now, cancellationToken);
        return schedule;
    }

    private async Task RevokeAllAsync(Guid userId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        foreach (var family in inner.Tokens.Where(t => t.UserId == userId).Select(t => t.FamilyId).Distinct())
        {
            await inner.RevokeFamilyAsync(family, now, cancellationToken);
        }
    }

    public sealed record Deletion(Guid Id, DateTimeOffset RequestedAt, DateTimeOffset ExecuteAfter, DateTimeOffset? CancelledAt);
}
