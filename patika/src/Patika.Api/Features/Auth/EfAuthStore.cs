using Microsoft.EntityFrameworkCore;
using Npgsql;
using Patika.Domain.Entities;
using Patika.Domain.Security;
using Patika.Infrastructure.Persistence;

namespace Patika.Api.Features.Auth;

/// <summary>EF Core implementation of <see cref="IAuthStore"/>; all queries are LINQ (parameterized).</summary>
public sealed class EfAuthStore(PatikaDbContext db) : IAuthStore
{
    private const string UniqueViolation = "23505";

    public async Task<AuthUser?> FindUserByIdAsync(Guid userId, CancellationToken cancellationToken)
    {
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == userId, cancellationToken);
        return user is null ? null : ToAuthUser(user);
    }

    public async Task<AuthUser?> FindUserByEmailAsync(string normalizedEmail, CancellationToken cancellationToken)
    {
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Email == normalizedEmail, cancellationToken);
        return user is null ? null : ToAuthUser(user);
    }

    public async Task<AuthUser?> FindUserByExternalLoginAsync(ExternalLoginKey login, CancellationToken cancellationToken)
    {
        var user = await db.ExternalLogins.AsNoTracking()
            .Where(l => l.Provider == login.Provider && l.Subject == login.Subject)
            .Join(db.Users, l => l.UserId, u => u.Id, (_, u) => u)
            .SingleOrDefaultAsync(cancellationToken);
        return user is null ? null : ToAuthUser(user);
    }

    public async Task<bool> TryCreateUserAsync(
        AuthUser user, ExternalLoginKey? login, EmailTokenRecord? emailToken, CancellationToken cancellationToken)
    {
        db.Users.Add(new User
        {
            Id = user.Id,
            Email = user.Email,
            EmailVerifiedAt = user.EmailVerifiedAt,
            PasswordHash = user.PasswordHash,
            DisplayName = user.DisplayName,
            Role = ToUserRole(user.Role),
            DeactivatedAt = user.DeactivatedAt,
        });
        if (login is not null)
        {
            db.ExternalLogins.Add(new ExternalLogin { Provider = login.Provider, Subject = login.Subject, UserId = user.Id });
        }

        if (emailToken is not null)
        {
            db.EmailTokens.Add(new EmailToken
            {
                Id = emailToken.Id,
                UserId = emailToken.UserId,
                TokenHash = emailToken.TokenHash,
                Purpose = emailToken.Purpose,
                CreatedAt = emailToken.CreatedAt,
                UpdatedAt = emailToken.CreatedAt,
                ExpiresAt = emailToken.ExpiresAt,
            });
        }

        return await TrySaveAsync(cancellationToken);
    }

    public async Task<Guid?> TryConsumeEmailTokenAsync(
        byte[] tokenHash, string purpose, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var token = await db.EmailTokens.AsNoTracking()
            .SingleOrDefaultAsync(t => t.TokenHash == tokenHash && t.Purpose == purpose, cancellationToken);
        if (token is null)
        {
            return null;
        }

        // Compare-and-set so that a token can be used once even under concurrent requests.
        var consumed = await db.EmailTokens
            .Where(t => t.Id == token.Id && t.UsedAt == null && t.ExpiresAt > now)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(t => t.UsedAt, now)
                .SetProperty(t => t.UpdatedAt, now), cancellationToken);
        if (consumed != 1)
        {
            await transaction.RollbackAsync(cancellationToken);
            return null;
        }

        if (purpose == EmailTokenRecord.VerifyEmail)
        {
            await db.Users
                .Where(u => u.Id == token.UserId && u.EmailVerifiedAt == null)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(u => u.EmailVerifiedAt, now)
                    .SetProperty(u => u.UpdatedAt, now), cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return token.UserId;
    }

    public async Task<bool> TryLinkExternalLoginAsync(Guid userId, ExternalLoginKey login, CancellationToken cancellationToken)
    {
        db.ExternalLogins.Add(new ExternalLogin { Provider = login.Provider, Subject = login.Subject, UserId = userId });
        return await TrySaveAsync(cancellationToken);
    }

    public async Task AddRefreshTokenAsync(RefreshTokenRecord token, CancellationToken cancellationToken)
    {
        db.RefreshTokens.Add(ToEntity(token));
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
    }

    public async Task<RefreshTokenRecord?> FindRefreshTokenAsync(byte[] tokenHash, CancellationToken cancellationToken)
    {
        var token = await db.RefreshTokens.AsNoTracking().SingleOrDefaultAsync(t => t.TokenHash == tokenHash, cancellationToken);
        return token is null
            ? null
            : new RefreshTokenRecord(token.Id, token.UserId, token.FamilyId, token.TokenHash, token.CreatedAt,
                token.ExpiresAt, token.RevokedAt, token.ReplacedById);
    }

    public async Task<bool> TryRotateRefreshTokenAsync(
        Guid currentId, RefreshTokenRecord replacement, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        // Rotation and family revocation both take row locks on the whole family first, in id order,
        // so they serialize: a revocation either sees the replacement or the rotation sees the revocation.
        var family = await LockFamilyAsync(replacement.FamilyId, cancellationToken);
        var current = family.SingleOrDefault(t => t.Id == currentId);
        if (current is null || current.RevokedAt is not null || IsFamilyRevoked(family))
        {
            await transaction.RollbackAsync(cancellationToken);
            return false;
        }

        db.RefreshTokens.Add(ToEntity(replacement));
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();

        var updated = await db.RefreshTokens
            .Where(t => t.Id == currentId && t.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(t => t.RevokedAt, now)
                .SetProperty(t => t.ReplacedById, replacement.Id)
                .SetProperty(t => t.UpdatedAt, now), cancellationToken);
        if (updated != 1)
        {
            await transaction.RollbackAsync(cancellationToken);
            return false;
        }

        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    public async Task<int> RevokeFamilyAsync(Guid familyId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await LockFamilyAsync(familyId, cancellationToken);

        // A separate statement after the lock wait, so it also sees a replacement committed meanwhile.
        var revoked = await db.RefreshTokens
            .Where(t => t.FamilyId == familyId && t.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(t => t.RevokedAt, now)
                .SetProperty(t => t.UpdatedAt, now), cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return revoked;
    }

    public async Task StoreEmailTokenAsync(EmailTokenRecord token, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await db.EmailTokens
            .Where(t => t.UserId == token.UserId && t.Purpose == token.Purpose && t.UsedAt == null)
            .ExecuteDeleteAsync(cancellationToken);
        db.EmailTokens.Add(new EmailToken
        {
            Id = token.Id,
            UserId = token.UserId,
            TokenHash = token.TokenHash,
            Purpose = token.Purpose,
            CreatedAt = token.CreatedAt,
            UpdatedAt = token.CreatedAt,
            ExpiresAt = token.ExpiresAt,
        });
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<Guid?> TryResetPasswordAsync(
        byte[] tokenHash, string newPasswordHash, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var token = await db.EmailTokens.AsNoTracking()
            .SingleOrDefaultAsync(t => t.TokenHash == tokenHash && t.Purpose == EmailTokenRecord.PasswordReset, cancellationToken);
        if (token is null)
        {
            return null;
        }

        // Compare-and-set: a reset code works once even under concurrent requests.
        var consumed = await db.EmailTokens
            .Where(t => t.Id == token.Id && t.UsedAt == null && t.ExpiresAt > now)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(t => t.UsedAt, now)
                .SetProperty(t => t.UpdatedAt, now), cancellationToken);
        var updated = consumed != 1 ? 0 : await db.Users
            .Where(u => u.Id == token.UserId && u.DeactivatedAt == null)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(u => u.PasswordHash, newPasswordHash)
                .SetProperty(u => u.EmailVerifiedAt, u => u.EmailVerifiedAt ?? now)
                .SetProperty(u => u.UpdatedAt, now), cancellationToken);
        if (updated != 1)
        {
            await transaction.RollbackAsync(cancellationToken);
            return null;
        }

        await db.EmailTokens
            .Where(t => t.UserId == token.UserId && t.Purpose == EmailTokenRecord.PasswordReset && t.UsedAt == null)
            .ExecuteDeleteAsync(cancellationToken);
        await RevokeAllForUserAsync(token.UserId, now, cancellationToken);
        await BumpSessionVersionAsync(db, token.UserId, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return token.UserId;
    }

    public async Task<int?> GetSessionVersionAsync(Guid userId, CancellationToken cancellationToken)
    {
        // Read by column name: users.session_version (int, not null, default 0).
        var versions = await db.Database
            .SqlQuery<int>($"SELECT session_version AS \"Value\" FROM users WHERE id = {userId}")
            .ToListAsync(cancellationToken);
        return versions.Count == 1 ? versions[0] : null;
    }

    public async Task<int?> TryIssueSessionAsync(
        RefreshTokenRecord token, string? expectedPasswordHash, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        // The row lock serializes with password reset, deletion requests and deletion cancels, which all
        // update this row first: either they see the new token (and revoke it) or this sees their change.
        var rows = await db.Database
            .SqlQuery<SessionRow>($"""
                SELECT session_version AS "Version", password_hash AS "PasswordHash"
                FROM users WHERE id = {token.UserId} AND deactivated_at IS NULL
                FOR UPDATE
                """)
            .ToListAsync(cancellationToken);
        if (rows.Count != 1
            || (expectedPasswordHash is not null && !string.Equals(rows[0].PasswordHash, expectedPasswordHash, StringComparison.Ordinal)))
        {
            await transaction.RollbackAsync(cancellationToken);
            return null;
        }

        db.RefreshTokens.Add(ToEntity(token));
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        await transaction.CommitAsync(cancellationToken);
        return rows[0].Version;
    }

    /// <summary>Increments <c>users.session_version</c>; callers run it inside their transaction.</summary>
    internal static Task<int> BumpSessionVersionAsync(PatikaDbContext db, Guid userId, CancellationToken cancellationToken) =>
        db.Database.ExecuteSqlAsync(
            $"UPDATE users SET session_version = session_version + 1 WHERE id = {userId}", cancellationToken);

    private sealed record SessionRow(int Version, string? PasswordHash);

    public async Task<bool> TryCancelPendingDeletionAsync(Guid userId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var cancelled = await db.DeletionRequests
            .Where(r => r.UserId == userId && r.CompletedAt == null && r.CancelledAt == null && r.ExecuteAfter > now)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(r => r.CancelledAt, now)
                .SetProperty(r => r.UpdatedAt, now), cancellationToken);
        if (cancelled == 0)
        {
            await transaction.RollbackAsync(cancellationToken);
            return false;
        }

        await db.Users
            .Where(u => u.Id == userId)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(u => u.DeactivatedAt, (DateTimeOffset?)null)
                .SetProperty(u => u.UpdatedAt, now), cancellationToken);

        // Tokens minted before the deletion request must not come back to life.
        await BumpSessionVersionAsync(db, userId, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    /// <summary>
    /// Revokes every active refresh token of the user, across all families. Must run inside a
    /// transaction: the user's tokens are locked first in id order (the same order rotation uses), and
    /// the revoking statement runs after the lock wait so it also sees a replacement committed meanwhile.
    /// </summary>
    internal async Task<int> RevokeAllForUserAsync(Guid userId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await db.RefreshTokens
            .FromSql($"SELECT * FROM refresh_tokens WHERE user_id = {userId} ORDER BY id FOR UPDATE")
            .AsNoTracking()
            .ToListAsync(cancellationToken);
        return await db.RefreshTokens
            .Where(t => t.UserId == userId && t.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(t => t.RevokedAt, now)
                .SetProperty(t => t.UpdatedAt, now), cancellationToken);
    }

    /// <summary>A revoked token that was never replaced marks the family as ended (logout or reuse).</summary>
    internal static bool IsFamilyRevoked(IEnumerable<RefreshToken> family) =>
        family.Any(t => t.RevokedAt is not null && t.ReplacedById is null);

    private Task<List<RefreshToken>> LockFamilyAsync(Guid familyId, CancellationToken cancellationToken) =>
        db.RefreshTokens
            .FromSql($"SELECT * FROM refresh_tokens WHERE family_id = {familyId} ORDER BY id FOR UPDATE")
            .AsNoTracking()
            .ToListAsync(cancellationToken);

    private async Task<bool> TrySaveAsync(CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException exception) when (exception.InnerException is PostgresException { SqlState: UniqueViolation })
        {
            return false;
        }
        finally
        {
            db.ChangeTracker.Clear();
        }
    }

    private static RefreshToken ToEntity(RefreshTokenRecord token) => new()
    {
        Id = token.Id,
        UserId = token.UserId,
        FamilyId = token.FamilyId,
        TokenHash = token.TokenHash,
        CreatedAt = token.CreatedAt,
        UpdatedAt = token.CreatedAt,
        ExpiresAt = token.ExpiresAt,
        RevokedAt = token.RevokedAt,
        ReplacedById = token.ReplacedById,
    };

    private static AuthUser ToAuthUser(User user) => new(
        user.Id, user.Email, user.PasswordHash, user.DisplayName, ToActorRole(user.Role), user.EmailVerifiedAt,
        user.DeactivatedAt);

    internal static ActorRole ToActorRole(UserRole role) => role switch
    {
        UserRole.User => ActorRole.User,
        UserRole.Trusted => ActorRole.Trusted,
        UserRole.Moderator => ActorRole.Moderator,
        UserRole.Admin => ActorRole.Admin,
        _ => ActorRole.User,
    };

    internal static UserRole ToUserRole(ActorRole role) => role switch
    {
        ActorRole.Trusted => UserRole.Trusted,
        ActorRole.Moderator => UserRole.Moderator,
        ActorRole.Admin => UserRole.Admin,
        _ => UserRole.User,
    };
}
