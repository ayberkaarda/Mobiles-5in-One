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

    public async Task<Guid?> TryRedeemEmailCodeAsync(
        Guid userId, string purpose, EmailCodeMatcher matches, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        if (await MatchLiveCodeAsync(userId, purpose, matches, now, cancellationToken) is not { } codeId)
        {
            // Commit: a wrong guess must stay counted.
            await transaction.CommitAsync(cancellationToken);
            return null;
        }

        await ConsumeCodeAsync(codeId, now, cancellationToken);
        if (purpose == EmailTokenRecord.VerifyEmail)
        {
            await db.Users
                .Where(u => u.Id == userId && u.EmailVerifiedAt == null)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(u => u.EmailVerifiedAt, now)
                    .SetProperty(u => u.UpdatedAt, now), cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return userId;
    }

    /// <summary>
    /// Locks the user's live code of the purpose (row lock, so concurrent guesses serialize and each
    /// re-reads the attempt count) and checks the presented code. On a mismatch the attempt is counted
    /// and the code is burned (marked used) once <see cref="EmailCodeHasher.MaxAttempts"/> is reached.
    /// Returns the code id on a match. Callers commit on both paths.
    /// </summary>
    private async Task<Guid?> MatchLiveCodeAsync(
        Guid userId, string purpose, EmailCodeMatcher matches, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var rows = await db.Database
            .SqlQuery<CodeRow>($"""
                SELECT id AS "Id", token_hash AS "TokenHash" FROM email_tokens
                WHERE user_id = {userId} AND purpose = {purpose} AND used_at IS NULL AND expires_at > {now}
                    AND failed_attempts < {EmailCodeHasher.MaxAttempts}
                ORDER BY created_at DESC
                LIMIT 1
                FOR UPDATE
                """)
            .ToListAsync(cancellationToken);
        if (rows.Count != 1)
        {
            return null;
        }

        var row = rows[0];
        if (matches(row.Id, row.TokenHash))
        {
            return row.Id;
        }

        await db.Database.ExecuteSqlAsync($"""
            UPDATE email_tokens
            SET failed_attempts = failed_attempts + 1,
                used_at = CASE WHEN failed_attempts + 1 >= {EmailCodeHasher.MaxAttempts} THEN {now} ELSE used_at END,
                updated_at = {now}
            WHERE id = {row.Id}
            """, cancellationToken);
        return null;
    }

    private Task<int> ConsumeCodeAsync(Guid codeId, DateTimeOffset now, CancellationToken cancellationToken) =>
        db.EmailTokens
            .Where(t => t.Id == codeId && t.UsedAt == null)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(t => t.UsedAt, now)
                .SetProperty(t => t.UpdatedAt, now), cancellationToken);

    private sealed record CodeRow(Guid Id, byte[] TokenHash);

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
                token.ExpiresAt, token.RevokedAt, token.ReplacedById, token.Mfa, token.AuthTime);
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

    public async Task<bool> StoreEmailTokenAsync(EmailTokenRecord token, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        // The user row lock serializes every issuance for this account, so the count and the
        // invalidation below see all earlier codes and at most one unused code ever exists.
        var locked = await db.Database
            .SqlQuery<Guid>($"SELECT id AS \"Value\" FROM users WHERE id = {token.UserId} FOR UPDATE")
            .ToListAsync(cancellationToken);
        var since = token.CreatedAt - EmailCodeHasher.IssueWindow;
        if (locked.Count != 1 || await db.EmailTokens.CountAsync(t => t.UserId == token.UserId
                && t.Purpose == token.Purpose && t.CreatedAt > since, cancellationToken) >= EmailCodeHasher.MaxIssuedPerWindow)
        {
            await transaction.RollbackAsync(cancellationToken);
            return false;
        }

        // Invalidate rather than delete: the rows keep counting towards the daily cap. Codes being
        // guessed right now hold their row lock, so this waits for them and they re-check used_at.
        await db.EmailTokens
            .Where(t => t.UserId == token.UserId && t.Purpose == token.Purpose && t.UsedAt == null)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(t => t.UsedAt, token.CreatedAt)
                .SetProperty(t => t.UpdatedAt, token.CreatedAt), cancellationToken);
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
        return true;
    }

    public async Task<Guid?> TryResetPasswordAsync(
        Guid userId, EmailCodeMatcher matches, string newPasswordHash, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        if (await MatchLiveCodeAsync(userId, EmailTokenRecord.PasswordReset, matches, now, cancellationToken) is not { } codeId)
        {
            // Commit: a wrong guess must stay counted.
            await transaction.CommitAsync(cancellationToken);
            return null;
        }

        // The code row is locked, so it is consumed exactly once even under concurrent requests.
        var consumed = await ConsumeCodeAsync(codeId, now, cancellationToken);
        var updated = consumed != 1 ? 0 : await db.Users
            .Where(u => u.Id == userId && u.DeactivatedAt == null)
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
            .Where(t => t.UserId == userId && t.Purpose == EmailTokenRecord.PasswordReset && t.UsedAt == null)
            .ExecuteDeleteAsync(cancellationToken);
        await RevokeAllForUserAsync(userId, now, cancellationToken);
        await BumpSessionVersionAsync(db, userId, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return userId;
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
                    AND (suspended_until IS NULL OR suspended_until <= {token.CreatedAt})
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
        Mfa = token.Mfa,
        AuthTime = token.AuthTime,
    };

    private static AuthUser ToAuthUser(User user) => new(
        user.Id, user.Email, user.PasswordHash, user.DisplayName, ToActorRole(user.Role), user.EmailVerifiedAt,
        user.DeactivatedAt)
    { TotpEnabledAt = user.TotpEnabledAt, SuspendedUntil = user.SuspendedUntil, SessionVersion = user.SessionVersion };

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
