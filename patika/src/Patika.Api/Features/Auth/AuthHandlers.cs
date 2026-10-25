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
    EmailCodeHasher codes,
    EmailCodeResendLimiter resendLimiter,
    IOptions<JwtSettings> jwtSettings,
    TimeProvider clock,
    ILogger<AuthHandlers> logger)
{
    public static readonly TimeSpan EmailTokenLifetime = EmailCodeHasher.Lifetime;
    public static readonly TimeSpan RecentAuthenticationWindow = TimeSpan.FromMinutes(10);
    public static readonly TimeSpan PasswordResetLifetime = EmailCodeHasher.Lifetime;

    /// <summary>Minimum duration of every forgot-password and resend response, known address or not.</summary>
    public static readonly TimeSpan ForgotResponseTime = TimeSpan.FromMilliseconds(400);

    /// <summary>Minimum duration of a rejected verification code, known address or not.</summary>
    public static readonly TimeSpan RejectedCodeResponseTime = TimeSpan.FromMilliseconds(250);

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
            var (code, emailToken) = NewEmailCode(user.Id, EmailTokenRecord.VerifyEmail, now);
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

    /// <summary>
    /// Always 202 with the same body. A known, active password account gets a single-use six-digit
    /// reset code (15 min) that replaces any earlier one; an unknown address gets nothing. Both paths
    /// take at least <see cref="ForgotResponseTime"/>,
    /// and the email is handed over without waiting for the provider beyond that floor, so neither the
    /// body nor the timing tells the two apart.
    /// </summary>
    public async Task<IResult> ForgotPasswordAsync(
        HttpContext http, ForgotPasswordRequest request, CancellationToken cancellationToken)
    {
        var started = clock.GetTimestamp();
        var email = EmailNormalizer.Normalize(request.Email);
        if (emailLimiter.Limiter.TryAcquire(email) is { } retryAfter)
        {
            logger.LogWarning("Password reset throttled for {Email}", email);
            return RateLimitingSetup.TooManyRequests(http, retryAfter);
        }

        // The code and its digest are produced on both paths.
        var user = await store.FindUserByEmailAsync(email, cancellationToken);
        var (code, record) = NewEmailCode(user?.Id ?? Guid.Empty, EmailTokenRecord.PasswordReset, clock.GetUtcNow());
        var delivery = Task.CompletedTask;
        if (user is { IsActive: true, PasswordHash: not null })
        {
            if (await store.StoreEmailTokenAsync(record, cancellationToken))
            {
                logger.LogInformation("Password reset requested for user {UserId}", user.Id);

                // Not tied to the request: a client that disconnects early must not cancel the email.
                delivery = SendDetachedAsync(AuthEmails.PasswordReset(email, code));
            }
            else
            {
                logger.LogWarning("Daily reset code cap reached for user {UserId}; nothing sent", user.Id);
            }
        }
        else
        {
            logger.LogInformation("Password reset requested for {Email} without an eligible account", email);
        }

        var floor = DelayUntilAsync(started, ForgotResponseTime);
        await Task.WhenAny(delivery, floor);
        await floor;
        return TypedResults.Accepted((string?)null, ForgotPasswordAcceptedResponse.Pending);
    }

    /// <summary>
    /// Redeems a reset code once: sets the new password and ends every session of the account
    /// (all refresh families revoked). The breach check runs first so a rejected password keeps the code usable.
    /// </summary>
    public async Task<IResult> ResetPasswordAsync(ResetPasswordRequest request, CancellationToken cancellationToken)
    {
        if (await breachedPasswords.IsBreachedAsync(request.NewPassword, cancellationToken))
        {
            return ValidationFilter<ResetPasswordRequest>.ValidationProblem(new Dictionary<string, string[]>
            {
                ["newPassword"] = ["This password appears in a known data breach. Choose a different one."],
            }, AuthErrorCodes.PasswordBreached);
        }

        // Argon2 runs on every path, so a reset for an unknown address costs the same as a wrong code.
        var hash = await hasher.HashAsync(request.NewPassword, cancellationToken);
        var user = await store.FindUserByEmailAsync(EmailNormalizer.Normalize(request.Email), cancellationToken);
        var userId = user is { IsActive: true }
            ? await store.TryResetPasswordAsync(user.Id, Matcher(EmailTokenRecord.PasswordReset, request.Code), hash,
                clock.GetUtcNow(), cancellationToken)
            : BurnEqualWork(EmailTokenRecord.PasswordReset, request.Code);
        if (userId is null)
        {
            return Problem(StatusCodes.Status400BadRequest, PasswordResetErrorCodes.ResetInvalid,
                "The reset code is invalid or has expired.");
        }

        SessionVersionCache.Shared.Invalidate(userId.Value);
        logger.LogInformation("User {UserId} reset their password; all sessions revoked", userId);
        return TypedResults.NoContent();
    }

    /// <summary>
    /// Always 202 with the registration body. An active, unverified password account gets a new
    /// six-digit code (15 min) and its previous code stops working; any other address gets nothing.
    /// Limited per address (<see cref="EmailCodeResendLimiter"/>) and per IP, and padded to
    /// <see cref="ForgotResponseTime"/> on every path.
    /// </summary>
    public async Task<IResult> ResendVerificationAsync(
        HttpContext http, ResendVerificationRequest request, CancellationToken cancellationToken)
    {
        var started = clock.GetTimestamp();
        var email = EmailNormalizer.Normalize(request.Email);
        if (resendLimiter.Limiter.TryAcquire(email) is { } retryAfter)
        {
            logger.LogWarning("Verification resend throttled for {Email}", email);
            return RateLimitingSetup.TooManyRequests(http, retryAfter);
        }

        var user = await store.FindUserByEmailAsync(email, cancellationToken);
        var (code, record) = NewEmailCode(user?.Id ?? Guid.Empty, EmailTokenRecord.VerifyEmail, clock.GetUtcNow());
        var delivery = Task.CompletedTask;
        if (user is { IsActive: true, EmailVerifiedAt: null, PasswordHash: not null })
        {
            if (await store.StoreEmailTokenAsync(record, cancellationToken))
            {
                logger.LogInformation("Verification code resent for user {UserId}", user.Id);
                delivery = SendDetachedAsync(AuthEmails.Verification(email, code));
            }
            else
            {
                logger.LogWarning("Daily verification code cap reached for user {UserId}; nothing sent", user.Id);
            }
        }
        else
        {
            logger.LogInformation("Verification resend requested for {Email} without a pending account", email);
        }

        var floor = DelayUntilAsync(started, ForgotResponseTime);
        await Task.WhenAny(delivery, floor);
        await floor;
        return Accepted();
    }

    private (string Code, EmailTokenRecord Record) NewEmailCode(Guid userId, string purpose, DateTimeOffset now)
    {
        var code = EmailCodeHasher.NewCode();
        var id = Guid.CreateVersion7();
        return (code, new EmailTokenRecord(id, userId, codes.Hash(id, purpose, code), purpose, now, now + EmailCodeHasher.Lifetime));
    }

    private EmailCodeMatcher Matcher(string purpose, string code) =>
        (codeId, storedHash) => codes.Matches(codeId, purpose, code, storedHash);

    /// <summary>The digest work of a code check, for an address without a live code; always null.</summary>
    private Guid? BurnEqualWork(string purpose, string code)
    {
        _ = codes.Matches(Guid.Empty, purpose, code, new byte[32]);
        return null;
    }

    private async Task SendDetachedAsync(EmailMessage message)
    {
        try
        {
            await emailSender.SendAsync(message, CancellationToken.None);
        }
        catch (Exception exception) when (exception is not OutOfMemoryException)
        {
            logger.LogError("Sending an email of kind {Kind} failed ({Failure})", message.Kind, exception.GetType().Name);
        }
    }

    private async Task DelayUntilAsync(long startedTimestamp, TimeSpan minimum)
    {
        // A loop because timers may fire a little early; the floor must hold on every path.
        for (var remaining = minimum - clock.GetElapsedTime(startedTimestamp);
             remaining > TimeSpan.Zero;
             remaining = minimum - clock.GetElapsedTime(startedTimestamp))
        {
            await Task.Delay(remaining + TimeSpan.FromMilliseconds(1), clock, CancellationToken.None);
        }
    }

    /// <summary>
    /// A correct sign-in during the deletion grace period cancels the deletion and reactivates the
    /// account. Returns the active user, or null when the account stays inactive.
    /// </summary>
    private async Task<AuthUser?> ActiveOrReactivatedAsync(AuthUser user, CancellationToken cancellationToken)
    {
        if (user.IsActive)
        {
            return user;
        }

        if (!await store.TryCancelPendingDeletionAsync(user.Id, clock.GetUtcNow(), cancellationToken))
        {
            return null;
        }

        SessionVersionCache.Shared.Invalidate(user.Id);
        logger.LogInformation("User {UserId} signed in during the grace period; account deletion cancelled", user.Id);
        return user with { DeactivatedAt = null };
    }

    /// <summary>
    /// Redeems the six-digit code sent to the address. An unknown address, a wrong, expired, replaced
    /// or burned code all get the same 400 body after the same <see cref="RejectedCodeResponseTime"/> floor.
    /// </summary>
    public async Task<IResult> VerifyEmailAsync(VerifyEmailRequest request, CancellationToken cancellationToken)
    {
        var started = clock.GetTimestamp();
        var candidate = await store.FindUserByEmailAsync(EmailNormalizer.Normalize(request.Email), cancellationToken);
        var userId = candidate is { IsActive: true }
            ? await store.TryRedeemEmailCodeAsync(candidate.Id, EmailTokenRecord.VerifyEmail,
                Matcher(EmailTokenRecord.VerifyEmail, request.Code), clock.GetUtcNow(), cancellationToken)
            : BurnEqualWork(EmailTokenRecord.VerifyEmail, request.Code);
        var user = userId is { } id ? await store.FindUserByIdAsync(id, cancellationToken) : null;
        if (user is null || !user.IsActive)
        {
            await DelayUntilAsync(started, RejectedCodeResponseTime);
            return Problem(StatusCodes.Status400BadRequest, AuthErrorCodes.VerificationInvalid,
                "The verification code is invalid or has expired.");
        }

        logger.LogInformation("User {UserId} verified their email address", user.Id);
        return await IssueAsync(user, PatikaClaims.EmailLinkMethod, expectedPasswordHash: null, cancellationToken) is { } tokens
            ? TypedResults.Ok(tokens)
            : Problem(StatusCodes.Status400BadRequest, AuthErrorCodes.VerificationInvalid,
                "The verification code is invalid or has expired.");
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
        // Unverified and inactive accounts get the same answer as a wrong password; an account in its
        // deletion grace period is reactivated only after the password has been checked.
        var active = user is null || !verified || user.EmailVerifiedAt is null
            ? null
            : await ActiveOrReactivatedAsync(user, cancellationToken);
        if (active is null)
        {
            logger.LogInformation("Login failed for {Email}", email);
            return InvalidCredentials();
        }

        user = active;

        logger.LogInformation("User {UserId} signed in with password", user.Id);
        // The hash that was just verified must still be the stored one when the session is issued.
        return await IssueAsync(user, PatikaClaims.PasswordMethod, user.PasswordHash, cancellationToken) is { } tokens
            ? TypedResults.Ok(tokens)
            : InvalidCredentials();
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

        var active = await ActiveOrReactivatedAsync(user, cancellationToken);
        if (active is null)
        {
            return Problem(StatusCodes.Status401Unauthorized, AuthErrorCodes.ExternalTokenInvalid, "Sign-in failed.");
        }

        user = active;
        return await IssueAsync(user, PatikaClaims.ExternalMethod, expectedPasswordHash: null, cancellationToken) is { } tokens
            ? TypedResults.Ok(tokens)
            : Problem(StatusCodes.Status401Unauthorized, AuthErrorCodes.ExternalTokenInvalid, "Sign-in failed.");
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

    internal static bool IsRecentPasswordAuthentication(ClaimsPrincipal principal, DateTimeOffset now) =>
        IsRecentAuthentication(principal, now, PatikaClaims.PasswordMethod);

    /// <summary>
    /// True when the access token was minted by an interactive sign-in with one of
    /// <paramref name="methods"/> within the last ten minutes. Refreshed tokens never qualify.
    /// </summary>
    internal static bool IsRecentAuthentication(ClaimsPrincipal principal, DateTimeOffset now, params string[] methods)
    {
        if (principal.FindFirstValue(PatikaClaims.AuthMethod) is not { } method
            || !methods.Contains(method, StringComparer.Ordinal)
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

        // Read before rotating: a reset that lands after this read revokes the replacement and bumps the
        // version past the one embedded below; one that landed before it makes the rotation fail.
        if (await store.GetSessionVersionAsync(user.Id, cancellationToken) is not { } version)
        {
            return RefreshInvalid();
        }

        var (refreshToken, record) = NewRefreshToken(user.Id, current.FamilyId, now);
        if (!await store.TryRotateRefreshTokenAsync(current.Id, record, now, cancellationToken))
        {
            await store.RevokeFamilyAsync(current.FamilyId, now, cancellationToken);
            logger.LogWarning("Concurrent refresh token reuse detected for user {UserId}", user.Id);
            return Problem(StatusCodes.Status401Unauthorized, AuthErrorCodes.RefreshReused, "Session is no longer valid.");
        }

        var (accessToken, expiresIn) = accessTokens.Issue(user.Id, user.Role, sessionVersion: version);
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

    /// <summary>
    /// Starts a new session family. The refresh token is stored under the user-row lock and the access
    /// token carries the session version read there; null when the account changed in the meantime
    /// (password replaced, deactivated), in which case nothing was issued.
    /// </summary>
    private async Task<TokenResponse?> IssueAsync(
        AuthUser user, string authMethod, string? expectedPasswordHash, CancellationToken cancellationToken)
    {
        var (refreshToken, record) = NewRefreshToken(user.Id, Guid.CreateVersion7(), clock.GetUtcNow());
        if (await store.TryIssueSessionAsync(record, expectedPasswordHash, cancellationToken) is not { } version)
        {
            logger.LogWarning("User {UserId} changed during sign-in; no session issued", user.Id);
            return null;
        }

        var (accessToken, expiresIn) = accessTokens.Issue(user.Id, user.Role, authMethod, version);
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
