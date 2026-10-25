using System.Security.Claims;
using Microsoft.Extensions.Options;
using Patika.Api.Email;
using Patika.Api.Security.Authorization;
using Patika.Api.Security.Passwords;
using Patika.Api.Security.RateLimiting;
using Patika.Api.Security.Tokens;
using Patika.Api.Validation;
using Patika.Contracts.Auth;
using Patika.Domain.Security;

namespace Patika.Api.Features.Auth;

/// <summary>Request handlers for <c>/v1/auth</c> and account linking. Failures return generic problem bodies.</summary>
public sealed class AuthHandlers(
    IAuthStore store,
    IPasswordHasher hasher,
    IBreachedPasswordChecker breachedPasswords,
    IAccessTokenIssuer accessTokens,
    IEnumerable<IExternalIdentityVerifier> externalVerifiers,
    IEmailSender emailSender,
    EmailRateLimiter emailLimiter,
    RefreshRateLimiter refreshLimiter,
    IOptions<JwtSettings> jwtSettings,
    TimeProvider clock,
    ILogger<AuthHandlers> logger)
{
    public static readonly TimeSpan EmailTokenLifetime = TimeSpan.FromHours(24);
    public static readonly TimeSpan RecentAuthenticationWindow = TimeSpan.FromMinutes(10);

    /// <summary>
    /// Always 202 with the same body for a well-formed request: a new address gets a verification
    /// code, an address that already has an account gets a registration-attempt notice instead.
    /// </summary>
    public async Task<IResult> RegisterAsync(HttpContext http, RegisterRequest request, CancellationToken cancellationToken)
    {
        var email = EmailNormalizer.Normalize(request.Email);
        if (emailLimiter.Limiter.TryAcquire(email) is { } retryAfter)
        {
            logger.LogWarning("Registration throttled for {Email}", email);
            return RateLimitingSetup.TooManyRequests(http, retryAfter);
        }

        if (await breachedPasswords.IsBreachedAsync(request.Password, cancellationToken))
        {
            return ValidationFilter<RegisterRequest>.ValidationProblem(new Dictionary<string, string[]>
            {
                ["password"] = ["This password appears in a known data breach. Choose a different one."],
            }, AuthErrorCodes.PasswordBreached);
        }

        // Hash on both paths so that response time does not tell existing and new addresses apart.
        var hash = await hasher.HashAsync(request.Password, cancellationToken);
        var existing = await store.FindUserByEmailAsync(email, cancellationToken);
        if (existing is null)
        {
            var now = clock.GetUtcNow();
            var user = new AuthUser(Guid.CreateVersion7(), email, hash, request.DisplayName.Trim(), ActorRole.User,
                EmailVerifiedAt: null, DeactivatedAt: null);
            var code = RefreshTokens.NewToken();
            var emailToken = new EmailTokenRecord(Guid.CreateVersion7(), user.Id, RefreshTokens.Hash(code),
                EmailTokenRecord.VerifyEmail, now, now + EmailTokenLifetime);
            if (await store.TryCreateUserAsync(user, login: null, emailToken, cancellationToken))
            {
                logger.LogInformation("User {UserId} registered with {Email}; verification pending", user.Id, email);
                await emailSender.SendAsync(AuthEmails.Verification(email, code), cancellationToken);
                return Accepted();
            }
        }

        logger.LogInformation("Registration attempt for an existing account {Email}", email);
        await emailSender.SendAsync(AuthEmails.RegistrationAttempt(email), cancellationToken);
        return Accepted();
    }

    public async Task<IResult> VerifyEmailAsync(VerifyEmailRequest request, CancellationToken cancellationToken)
    {
        var userId = await store.TryConsumeEmailTokenAsync(
            RefreshTokens.Hash(request.Token), EmailTokenRecord.VerifyEmail, clock.GetUtcNow(), cancellationToken);
        var user = userId is { } id ? await store.FindUserByIdAsync(id, cancellationToken) : null;
        if (user is null || !user.IsActive)
        {
            return Problem(StatusCodes.Status400BadRequest, AuthErrorCodes.VerificationInvalid,
                "The verification code is invalid or has expired.");
        }

        logger.LogInformation("User {UserId} verified their email address", user.Id);
        return TypedResults.Ok(await IssueAsync(user, Guid.CreateVersion7(), PatikaClaims.EmailLinkMethod, cancellationToken));
    }

    public async Task<IResult> LoginAsync(HttpContext http, LoginRequest request, CancellationToken cancellationToken)
    {
        var email = EmailNormalizer.Normalize(request.Email);
        if (emailLimiter.Limiter.TryAcquire(email) is { } retryAfter)
        {
            logger.LogWarning("Login throttled for {Email}", email);
            return RateLimitingSetup.TooManyRequests(http, retryAfter);
        }

        var user = await store.FindUserByEmailAsync(email, cancellationToken);

        // Always hash, even for unknown users or external-only accounts, so timing does not leak existence.
        // Unverified accounts get the same answer as a wrong password.
        var verified = await hasher.VerifyAsync(request.Password, user?.PasswordHash, cancellationToken);
        if (user is null || !verified || !user.IsActive || user.EmailVerifiedAt is null)
        {
            logger.LogInformation("Login failed for {Email}", email);
            return InvalidCredentials();
        }

        logger.LogInformation("User {UserId} signed in with password", user.Id);
        return TypedResults.Ok(await IssueAsync(user, Guid.CreateVersion7(), PatikaClaims.PasswordMethod, cancellationToken));
    }

    /// <summary>
    /// External sign-in never links by email. An unknown identity whose email belongs to an existing
    /// account gets 409 <c>link_required</c>; the owner links it from a fresh password session.
    /// </summary>
    public async Task<IResult> ExternalAsync(string provider, string token, CancellationToken cancellationToken)
    {
        var identity = await VerifyExternalAsync(provider, token, cancellationToken);
        if (identity is null)
        {
            return Problem(StatusCodes.Status401Unauthorized, AuthErrorCodes.ExternalTokenInvalid, "Sign-in failed.");
        }

        var key = new ExternalLoginKey(identity.Provider, identity.Subject);
        var user = await store.FindUserByExternalLoginAsync(key, cancellationToken);
        if (user is null)
        {
            var email = identity.Email is null ? null : EmailNormalizer.Normalize(identity.Email);
            if (email is not null && await store.FindUserByEmailAsync(email, cancellationToken) is not null)
            {
                return LinkRequired();
            }

            var verifiedEmail = identity.EmailVerified ? email : null;
            var created = new AuthUser(Guid.CreateVersion7(), verifiedEmail, PasswordHash: null,
                DisplayNameFrom(identity), ActorRole.User,
                EmailVerifiedAt: verifiedEmail is null ? null : clock.GetUtcNow(), DeactivatedAt: null);
            if (!await store.TryCreateUserAsync(created, key, emailToken: null, cancellationToken))
            {
                return LinkRequired();
            }

            logger.LogInformation("User {UserId} registered through {Provider}", created.Id, identity.Provider);
            user = created;
        }

        if (!user.IsActive)
        {
            return Problem(StatusCodes.Status401Unauthorized, AuthErrorCodes.ExternalTokenInvalid, "Sign-in failed.");
        }

        return TypedResults.Ok(await IssueAsync(user, Guid.CreateVersion7(), PatikaClaims.ExternalMethod, cancellationToken));
    }

    /// <summary>
    /// Links an external identity to the signed-in account. Requires an access token minted by a
    /// password sign-in within the last ten minutes (<c>amr=pwd</c>, <c>auth_time</c>).
    /// </summary>
    public async Task<IResult> LinkExternalAsync(
        ClaimsPrincipal principal, string provider, string token, CancellationToken cancellationToken)
    {
        var actor = ActorFactory.FromPrincipal(principal);
        if (actor.UserId is not { } userId)
        {
            return TypedResults.Unauthorized();
        }

        if (!IsRecentPasswordAuthentication(principal, clock.GetUtcNow()))
        {
            return Problem(StatusCodes.Status403Forbidden, AuthErrorCodes.ReauthenticationRequired,
                "Sign in with your password again to link an account.");
        }

        var identity = await VerifyExternalAsync(provider, token, cancellationToken);
        if (identity is null)
        {
            return Problem(StatusCodes.Status400BadRequest, AuthErrorCodes.ExternalTokenInvalid, "Linking failed.");
        }

        var key = new ExternalLoginKey(identity.Provider, identity.Subject);
        var owner = await store.FindUserByExternalLoginAsync(key, cancellationToken);
        if (owner is not null)
        {
            return owner.Id == userId
                ? TypedResults.NoContent()
                : Problem(StatusCodes.Status409Conflict, AuthErrorCodes.ExternalLoginInUse, "Linking failed.");
        }

        if (!await store.TryLinkExternalLoginAsync(userId, key, cancellationToken))
        {
            return Problem(StatusCodes.Status409Conflict, AuthErrorCodes.ExternalLoginInUse, "Linking failed.");
        }

        logger.LogInformation("User {UserId} linked a {Provider} login", userId, identity.Provider);
        return TypedResults.NoContent();
    }

    internal static bool IsRecentPasswordAuthentication(ClaimsPrincipal principal, DateTimeOffset now)
    {
        if (principal.FindFirstValue(PatikaClaims.AuthMethod) != PatikaClaims.PasswordMethod
            || !long.TryParse(principal.FindFirstValue(PatikaClaims.AuthTime), out var seconds))
        {
            return false;
        }

        var age = now - DateTimeOffset.FromUnixTimeSeconds(seconds);
        return age >= TimeSpan.FromSeconds(-30) && age <= RecentAuthenticationWindow;
    }

    private async Task<ExternalIdentity?> VerifyExternalAsync(string provider, string token, CancellationToken cancellationToken)
    {
        var verifier = externalVerifiers.FirstOrDefault(v => string.Equals(v.Provider, provider, StringComparison.Ordinal));
        return verifier is null ? null : await verifier.VerifyAsync(token, cancellationToken);
    }

    private static IResult Accepted() => TypedResults.Accepted((string?)null, RegisterAcceptedResponse.Pending);

    private static IResult LinkRequired() => Problem(StatusCodes.Status409Conflict, AuthErrorCodes.LinkRequired,
        "An account already uses this email. Sign in with your password and link this login from your profile.");

    public async Task<IResult> RefreshAsync(HttpContext http, RefreshRequest request, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        var current = await store.FindRefreshTokenAsync(RefreshTokens.Hash(request.RefreshToken), cancellationToken);
        if (current is null)
        {
            return RefreshInvalid();
        }

        if (current.RevokedAt is not null)
        {
            // A rotated (or logged-out) token came back: assume theft and end the whole session family.
            var revoked = await store.RevokeFamilyAsync(current.FamilyId, now, cancellationToken);
            logger.LogWarning("Refresh token reuse detected for user {UserId}; revoked {Count} tokens in family {FamilyId}",
                current.UserId, revoked, current.FamilyId);
            return Problem(StatusCodes.Status401Unauthorized, AuthErrorCodes.RefreshReused, "Session is no longer valid.");
        }

        if (current.ExpiresAt <= now)
        {
            return RefreshInvalid();
        }

        var user = await store.FindUserByIdAsync(current.UserId, cancellationToken);
        if (user is null || !user.IsActive)
        {
            await store.RevokeFamilyAsync(current.FamilyId, now, cancellationToken);
            return RefreshInvalid();
        }

        if (refreshLimiter.Limiter.TryAcquire(user.Id.ToString()) is { } retryAfter)
        {
            return RateLimitingSetup.TooManyRequests(http, retryAfter);
        }

        var (refreshToken, record) = NewRefreshToken(user.Id, current.FamilyId, now);
        if (!await store.TryRotateRefreshTokenAsync(current.Id, record, now, cancellationToken))
        {
            await store.RevokeFamilyAsync(current.FamilyId, now, cancellationToken);
            logger.LogWarning("Concurrent refresh token reuse detected for user {UserId}", user.Id);
            return Problem(StatusCodes.Status401Unauthorized, AuthErrorCodes.RefreshReused, "Session is no longer valid.");
        }

        var (accessToken, expiresIn) = accessTokens.Issue(user.Id, user.Role);
        return TypedResults.Ok(new TokenResponse(accessToken, "Bearer", expiresIn, refreshToken, RefreshLifetimeSeconds));
    }

    public async Task<IResult> LogoutAsync(LogoutRequest request, CancellationToken cancellationToken)
    {
        var current = await store.FindRefreshTokenAsync(RefreshTokens.Hash(request.RefreshToken), cancellationToken);
        if (current is not null)
        {
            await store.RevokeFamilyAsync(current.FamilyId, clock.GetUtcNow(), cancellationToken);
            logger.LogInformation("User {UserId} signed out", current.UserId);
        }

        // Same response whether or not the token existed.
        return TypedResults.NoContent();
    }

    private int RefreshLifetimeSeconds => (int)TimeSpan.FromDays(jwtSettings.Value.RefreshTokenDays).TotalSeconds;

    private async Task<TokenResponse> IssueAsync(
        AuthUser user, Guid familyId, string authMethod, CancellationToken cancellationToken)
    {
        var (refreshToken, record) = NewRefreshToken(user.Id, familyId, clock.GetUtcNow());
        await store.AddRefreshTokenAsync(record, cancellationToken);
        var (accessToken, expiresIn) = accessTokens.Issue(user.Id, user.Role, authMethod);
        return new TokenResponse(accessToken, "Bearer", expiresIn, refreshToken, RefreshLifetimeSeconds);
    }

    private (string Token, RefreshTokenRecord Record) NewRefreshToken(Guid userId, Guid familyId, DateTimeOffset now)
    {
        var token = RefreshTokens.NewToken();
        var record = new RefreshTokenRecord(Guid.CreateVersion7(), userId, familyId, RefreshTokens.Hash(token), now,
            now.AddDays(jwtSettings.Value.RefreshTokenDays), RevokedAt: null, ReplacedById: null);
        return (token, record);
    }

    private static string DisplayNameFrom(ExternalIdentity identity)
    {
        var candidate = identity.Name?.Trim();
        if (candidate is null or "" || !TextRules.HasNoControlCharacters(candidate))
        {
            candidate = "Patika gönüllüsü";
        }

        return candidate.Length > 60 ? candidate[..60] : candidate;
    }

    private static IResult InvalidCredentials() =>
        Problem(StatusCodes.Status401Unauthorized, AuthErrorCodes.InvalidCredentials, "Email or password is incorrect.");

    private static IResult RefreshInvalid() =>
        Problem(StatusCodes.Status401Unauthorized, AuthErrorCodes.RefreshInvalid, "Session is no longer valid.");

    internal static IResult Problem(int status, string code, string title) =>
        TypedResults.Problem(title: title, statusCode: status, extensions: new Dictionary<string, object?> { ["code"] = code });
}
