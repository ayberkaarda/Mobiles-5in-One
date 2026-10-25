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
}

public sealed record RefreshTokenRecord(
    Guid Id,
    Guid UserId,
    Guid FamilyId,
    byte[] TokenHash,
    DateTimeOffset CreatedAt,
    DateTimeOffset ExpiresAt,
    DateTimeOffset? RevokedAt,
    Guid? ReplacedById);

public sealed record ExternalLoginKey(string Provider, string Subject);

public sealed record EmailTokenRecord(
    Guid Id,
    Guid UserId,
    byte[] TokenHash,
    string Purpose,
    DateTimeOffset CreatedAt,
    DateTimeOffset ExpiresAt)
{
    public const string VerifyEmail = "verify_email";
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
    /// Atomically consumes an unused, unexpired email token of the given purpose and, for
    /// <see cref="EmailTokenRecord.VerifyEmail"/>, marks the address verified. Returns the user id or null.
    /// </summary>
    Task<Guid?> TryConsumeEmailTokenAsync(byte[] tokenHash, string purpose, DateTimeOffset now, CancellationToken cancellationToken);

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
}
