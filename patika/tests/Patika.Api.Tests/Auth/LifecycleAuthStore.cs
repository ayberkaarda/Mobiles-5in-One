using Patika.Api.Features.Account;
using Patika.Api.Features.Auth;
using Patika.Api.Tests.Infrastructure;

namespace Patika.Api.Tests.Auth;

/// <summary>
/// Wraps the shared <see cref="InMemoryAuthStore"/> and adds password reset and deletion requests with
/// the same semantics as the EF stores (code attempts and burn, single use, expiry, grace period, full revocation).
/// </summary>
public sealed class LifecycleAuthStore(InMemoryAuthStore inner) : IAuthStore, IAccountDeletionStore
{
    private readonly Lock gate = new();
    private readonly Dictionary<Guid, Deletion> deletions = [];

    public InMemoryAuthStore Inner => inner;

    public int ResetTokenCount => inner.CodeCount(EmailTokenRecord.PasswordReset);

    public int LiveResetTokenCount => inner.LiveCodeCount(EmailTokenRecord.PasswordReset);

    public Deletion? DeletionFor(Guid userId)
    {
        lock (gate)
        {
            return deletions.GetValueOrDefault(userId);
        }
    }

    public void ExpireResetTokens() => inner.ExpireEmailTokens(EmailTokenRecord.PasswordReset);

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

    public Task<Guid?> TryRedeemEmailCodeAsync(
        Guid userId, string purpose, EmailCodeMatcher matches, DateTimeOffset now, CancellationToken cancellationToken) =>
        inner.TryRedeemEmailCodeAsync(userId, purpose, matches, now, cancellationToken);

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

    public Task<bool> StoreEmailTokenAsync(EmailTokenRecord token, CancellationToken cancellationToken) =>
        inner.StoreEmailTokenAsync(token, cancellationToken);

    public async Task<Guid?> TryResetPasswordAsync(
        Guid userId, EmailCodeMatcher matches, string newPasswordHash, DateTimeOffset now, CancellationToken cancellationToken)
    {
        lock (gate)
        {
            if (inner.Users.SingleOrDefault(u => u.Id == userId) is not { IsActive: true }
                || inner.RedeemCode(userId, EmailTokenRecord.PasswordReset, matches, now) is null)
            {
                return null;
            }

            inner.RemoveUnusedCodes(userId, EmailTokenRecord.PasswordReset);
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
