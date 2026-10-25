using Patika.Domain.Security;

namespace Patika.Api.Features.Auth;

public sealed record AuthUser(
    Guid Id,
    string? Email,
    string? PasswordHash,
    string DisplayName,
    ActorRole Role,
    DateTimeOffset? EmailVerifiedAt,
    DateTimeOffset? DeactivatedAt)
{
    public bool IsActive => DeactivatedAt is null;

    /// <summary>
    /// <c>users.session_version</c>. Only stores that track it set this (the in-memory test store and its
    /// wrapper); <see cref="EfAuthStore"/> reads the column where a session is issued or checked.
    /// </summary>
    public int SessionVersion { get; init; }
    public DateTimeOffset? TotpEnabledAt { get; init; }
    public DateTimeOffset? SuspendedUntil { get; init; }
}

public sealed record RefreshTokenRecord(
    Guid Id,
    Guid UserId,
    Guid FamilyId,
    byte[] TokenHash,
    DateTimeOffset CreatedAt,
    DateTimeOffset ExpiresAt,
    DateTimeOffset? RevokedAt,
    Guid? ReplacedById,
    bool Mfa = false,
    DateTimeOffset? AuthTime = null);

public sealed record ExternalLoginKey(string Provider, string Subject);

/// <summary>Checks a presented code against the stored digest of the code row <paramref name="codeId"/>.</summary>
public delegate bool EmailCodeMatcher(Guid codeId, byte[] storedHash);

/// <summary>An email code row. <c>TokenHash</c> is the keyed digest from <see cref="EmailCodeHasher"/>.</summary>
public sealed record EmailTokenRecord(
    Guid Id,
    Guid UserId,
    byte[] TokenHash,
    string Purpose,
    DateTimeOffset CreatedAt,
    DateTimeOffset ExpiresAt)
{
    public const string VerifyEmail = "verify_email";
    public const string PasswordReset = "password_reset";
}

/// <summary>Persistence port for the auth slice; the production implementation is <see cref="EfAuthStore"/>.</summary>
public interface IAuthStore
{
    Task<AuthUser?> FindUserByIdAsync(Guid userId, CancellationToken cancellationToken);

    Task<AuthUser?> FindUserByEmailAsync(string normalizedEmail, CancellationToken cancellationToken);

    Task<AuthUser?> FindUserByExternalLoginAsync(ExternalLoginKey login, CancellationToken cancellationToken);

    /// <summary>Creates the user with an optional external login and email token; false when the email or login is taken.</summary>
    Task<bool> TryCreateUserAsync(
        AuthUser user, ExternalLoginKey? login, EmailTokenRecord? emailToken, CancellationToken cancellationToken);

    /// <summary>
    /// Redeems the user's live code of <paramref name="purpose"/> (newest, unused, unexpired, fewer than
    /// <see cref="EmailCodeHasher.MaxAttempts"/> wrong guesses) when <paramref name="matches"/> accepts it,
    /// and for <see cref="EmailTokenRecord.VerifyEmail"/> marks the address verified. A rejected guess
    /// counts against the code and the last allowed wrong guess burns it. Returns the user id or null.
    /// </summary>
    Task<Guid?> TryRedeemEmailCodeAsync(
        Guid userId, string purpose, EmailCodeMatcher matches, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>Links an external login to an existing user; false when the login already exists.</summary>
    Task<bool> TryLinkExternalLoginAsync(Guid userId, ExternalLoginKey login, CancellationToken cancellationToken);

    Task AddRefreshTokenAsync(RefreshTokenRecord token, CancellationToken cancellationToken);

    Task<RefreshTokenRecord?> FindRefreshTokenAsync(byte[] tokenHash, CancellationToken cancellationToken);

    /// <summary>
    /// Atomically revokes <paramref name="currentId"/> if it is still active and stores its replacement.
    /// Returns false (and stores nothing) when the token was already revoked by a concurrent request.
    /// </summary>
    Task<bool> TryRotateRefreshTokenAsync(
        Guid currentId, RefreshTokenRecord replacement, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>Revokes every still-active token of the family; returns the number revoked.</summary>
    Task<int> RevokeFamilyAsync(Guid familyId, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>
    /// Stores a new email code after invalidating the user's unused codes of the same purpose (at most
    /// one live code per user and purpose), serialized per user. Returns false and stores nothing when
    /// <see cref="EmailCodeHasher.MaxIssuedPerWindow"/> codes of the purpose were already issued within
    /// <see cref="EmailCodeHasher.IssueWindow"/>, or when the user does not exist.
    /// </summary>
    Task<bool> StoreEmailTokenAsync(EmailTokenRecord token, CancellationToken cancellationToken) =>
        throw new NotSupportedException("This store does not support issuing standalone email tokens.");

    /// <summary>
    /// In one transaction: redeems the user's live <see cref="EmailTokenRecord.PasswordReset"/> code exactly like
    /// <see cref="TryRedeemEmailCodeAsync"/> (wrong guesses count and burn),
    /// sets the new password hash on the (active) owner, marks the address verified, deletes the
    /// owner's other unused reset tokens and revokes every refresh token of every family the owner
    /// has, and increments the session version so outstanding access tokens stop working. Returns the
    /// user id, or null when the token is unknown, used, expired or the account is inactive.
    /// </summary>
    Task<Guid?> TryResetPasswordAsync(
        Guid userId, EmailCodeMatcher matches, string newPasswordHash, DateTimeOffset now, CancellationToken cancellationToken) =>
        throw new NotSupportedException("This store does not support password reset.");

    /// <summary>
    /// Cancels the user's pending deletion request when its grace period has not ended and reactivates
    /// the account with a new session version (tokens from before the request stay invalid). Returns false
    /// when there is nothing to cancel (for example a moderation deactivation).
    /// </summary>
    Task<bool> TryCancelPendingDeletionAsync(Guid userId, DateTimeOffset now, CancellationToken cancellationToken) =>
        Task.FromResult(false);

    /// <summary>
    /// The account's <c>session_version</c>, or null when the account does not exist. Every access token
    /// carries the version it was minted with; password reset, a deletion request and a deletion cancel
    /// increment it, which rejects every older token.
    /// </summary>
    async Task<int?> GetSessionVersionAsync(Guid userId, CancellationToken cancellationToken) =>
        (await FindUserByIdAsync(userId, cancellationToken))?.SessionVersion;

    /// <summary>
    /// Stores the first refresh token of a new session family under a lock on the user row and returns the
    /// session version to embed in the access token. Returns null (and stores nothing) when the account is
    /// gone or inactive, or when <paramref name="expectedPasswordHash"/> is given and the stored hash no
    /// longer matches it, so a sign-in that checked an old password cannot outlive a concurrent reset.
    /// </summary>
    async Task<int?> TryIssueSessionAsync(
        RefreshTokenRecord token, string? expectedPasswordHash, CancellationToken cancellationToken)
    {
        var user = await FindUserByIdAsync(token.UserId, cancellationToken);
        if (user is not { IsActive: true }
            || (expectedPasswordHash is not null && !string.Equals(user.PasswordHash, expectedPasswordHash, StringComparison.Ordinal)))
        {
            return null;
        }

        await AddRefreshTokenAsync(token, cancellationToken);
        return user.SessionVersion;
    }
}
