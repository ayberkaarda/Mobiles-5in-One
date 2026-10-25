using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Patika.Api.Features.Admin;
using Patika.Api.Security.Authorization;
using Patika.Api.Security.Tokens;
using Patika.Contracts.Admin;
using Patika.Contracts.Auth;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;

namespace Patika.Api.Features.Auth;

public sealed class TotpService(
    PatikaDbContext db, IDataProtectionProvider protection, EmailCodeHasher hashes,
    IAccessTokenIssuer accessTokens, IOptions<JwtSettings> settings, TimeProvider clock)
{
    private readonly IDataProtector protector = protection.CreateProtector("Patika.Totp.v1");

    public async Task<User?> LockUserAsync(Guid id, CancellationToken ct)
    {
        // Refresh a tracked row after waiting for the lock, rather than reusing an earlier snapshot.
        var user = await db.Users.FromSql($"SELECT * FROM users WHERE id = {id} FOR UPDATE").SingleOrDefaultAsync(ct);
        if (user is not null) await db.Entry(user).ReloadAsync(ct);
        return user;
    }

    public async Task<IResult> EnrolAsync(ClaimsPrincipal principal, CancellationToken ct)
    {
        if (!long.TryParse(principal.FindFirstValue(PatikaClaims.AuthTime), out var seconds)
            || seconds < clock.GetUtcNow().AddMinutes(-10).ToUnixTimeSeconds()
            || seconds > clock.GetUtcNow().AddSeconds(30).ToUnixTimeSeconds()) return Error(403, "recent_sign_in_required");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var user = await LockUserAsync(UserId(principal), ct);
        if (user is null) return TypedResults.Unauthorized();
        if (user.TotpEnabledAt is not null) return Error(409, "totp_already_enabled");
        var secret = RandomNumberGenerator.GetBytes(20);
        user.TotpSecretEnc = protector.Protect(Convert.ToBase64String(secret));
        user.TotpLastStep = -1;
        // Enrolment never resets the persistent attempt budget.
        Audit(user.Id, "totp.enrol", "user", user.Id);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        var encoded = TotpAlgorithm.Base32(secret);
        CryptographicOperations.ZeroMemory(secret);
        var label = Uri.EscapeDataString(AdminPrivacy.MaskEmail(user.Email) ?? "***");
        return TypedResults.Ok(new TotpEnrolResponse($"otpauth://totp/{label}?secret={encoded}&issuer=Patika&algorithm=SHA1&digits=6&period=30", encoded));
    }

    public async Task<IResult> ConfirmAsync(ClaimsPrincipal principal, string? code, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var user = await LockUserAsync(UserId(principal), ct);
        if (user is null) return TypedResults.Unauthorized();
        if (user.TotpEnabledAt is not null) return Error(409, "totp_already_enabled");
        if (!await VerifyAsync(user, code, null, allowPending: true, ct))
            return await FailedAsync(tx, ct);
        user.TotpEnabledAt = clock.GetUtcNow();
        await db.TotpRecoveryCodes.Where(x => x.UserId == user.Id).ExecuteDeleteAsync(ct);
        var codes = new List<string>();
        for (var i = 0; i < 10; i++)
        {
            var recovery = Convert.ToHexString(RandomNumberGenerator.GetBytes(10));
            var row = new TotpRecoveryCode { UserId = user.Id, CodeHash = [] };
            row.CodeHash = hashes.Hash(row.Id, "totp_recovery", recovery);
            codes.Add(recovery);
            db.TotpRecoveryCodes.Add(row);
        }
        Audit(user.Id, "totp.confirm", "user", user.Id);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return TypedResults.Ok(new TotpConfirmResponse(codes));
    }

    public async Task<IResult> DisableAsync(ClaimsPrincipal principal, string? code, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var user = await LockUserAsync(UserId(principal), ct);
        if (user is null) return TypedResults.Unauthorized();
        if (user.Role is UserRole.Moderator or UserRole.Admin) return Error(403, "totp_role_required");
        if (!await VerifyAsync(user, code, null, false, ct)) return await FailedAsync(tx, ct);
        user.TotpEnabledAt = null;
        user.TotpSecretEnc = null;
        user.TotpLastStep = -1;
        user.SessionVersion++;
        await new EfAuthStore(db).RevokeAllForUserAsync(user.Id, clock.GetUtcNow(), ct);
        await db.TotpRecoveryCodes.Where(x => x.UserId == user.Id).ExecuteDeleteAsync(ct);
        Audit(user.Id, "totp.disable", "user", user.Id);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        SessionVersionCache.Shared.Invalidate(user.Id);
        return TypedResults.NoContent();
    }

    public async Task<IResult> StartMfaAsync(AuthUser candidate, string? expectedHash, string authMethod, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var user = await LockUserAsync(candidate.Id, ct);
        if (user is null || user.DeactivatedAt is not null || user.SuspendedUntil > clock.GetUtcNow()
            || user.TotpEnabledAt is null || user.Role is not (UserRole.Moderator or UserRole.Admin)
            || (expectedHash is not null && user.PasswordHash != expectedHash)) return Error(401, "invalid_credentials");
        var token = NewToken(user, Guid.CreateVersion7(), "mfa", null, clock.GetUtcNow(), authMethod);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return TypedResults.Accepted((string?)null, new MfaRequiredResponse(true, token));
    }

    public async Task<IResult> CompleteMfaAsync(MfaRequest request, CancellationToken ct)
    {
        if (!RefreshTokens.LooksValid(request.MfaToken)) return Error(401, "mfa_invalid");
        var hash = RefreshTokens.Hash(request.MfaToken);
        var candidate = await db.AdminAccessTokens.AsNoTracking().SingleOrDefaultAsync(x => x.TokenHash == hash && x.Purpose == "mfa", ct);
        if (candidate is null) return Error(401, "mfa_invalid");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var user = await LockUserAsync(candidate.UserId, ct);
        var challenge = await db.AdminAccessTokens.SingleAsync(x => x.Id == candidate.Id, ct);
        await db.Entry(challenge).ReloadAsync(ct);
        var now = clock.GetUtcNow();
        if (user is null || user.DeactivatedAt is not null || user.SessionVersion != challenge.SessionVersion
            || challenge.UsedAt is not null || challenge.ExpiresAt <= now) return Error(401, "mfa_invalid");
        if (user.SuspendedUntil > now) return Error(403, "account_suspended");
        if (user.Role is not (UserRole.Moderator or UserRole.Admin)) return Error(401, "mfa_invalid");
        if (!await VerifyAsync(user, request.Code, request.RecoveryCode, false, ct)) return await FailedAsync(tx, ct);
        challenge.UsedAt = now;
        var refresh = RefreshTokens.NewToken();
        var lifetime = TimeSpan.FromDays(settings.Value.RefreshTokenDays);
        db.RefreshTokens.Add(new RefreshToken
        {
            UserId = user.Id,
            FamilyId = challenge.SessionId,
            TokenHash = RefreshTokens.Hash(refresh),
            ExpiresAt = now + lifetime,
            Mfa = true,
            AuthTime = challenge.AuthTime,
        });
        Audit(user.Id, "totp.login", "user", user.Id);
        var (access, expires) = accessTokens.Issue(user.Id, EfAuthStore.ToActorRole(user.Role), challenge.AuthMethod,
            user.SessionVersion, challenge.SessionId, challenge.AuthTime, mfa: true);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return TypedResults.Ok(new TokenResponse(access, "Bearer", expires, refresh, (int)lifetime.TotalSeconds));
    }

    public async Task<IResult> StepUpAsync(ClaimsPrincipal principal, StepUpRequest request, CancellationToken ct)
    {
        if (!ReasonValid(request.Reason, 300) || !Guid.TryParse(principal.FindFirstValue(PatikaClaims.SessionId), out var session))
            return Error(400, "step_up_invalid");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var user = await LockUserAsync(UserId(principal), ct);
        if (user is null) return TypedResults.Unauthorized();
        if (!await VerifyAsync(user, request.Code, null, false, ct)) return await FailedAsync(tx, ct);
        var token = NewToken(user, session, "step_up", request.Reason.Trim(), clock.GetUtcNow());
        // Not a moderation decision: the action that consumes the token records its own decision.
        Audit(user.Id, "totp.step_up", "user", user.Id, new { reason = request.Reason.Trim() });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return TypedResults.Ok(new StepUpResponse(token));
    }

    // Call inside the action transaction. The conditional update serializes competing uses.
    public async Task<string?> ConsumeStepUpAsync(ClaimsPrincipal principal, string? token, CancellationToken ct)
    {
        if (!RefreshTokens.LooksValid(token) || !Guid.TryParse(principal.FindFirstValue(PatikaClaims.SessionId), out var session)
            || !int.TryParse(principal.FindFirstValue(PatikaClaims.SessionVersion), NumberStyles.None, CultureInfo.InvariantCulture, out var version)) return null;
        var id = UserId(principal);
        var hash = RefreshTokens.Hash(token!);
        var now = clock.GetUtcNow();
        var query = db.AdminAccessTokens.Where(x => x.TokenHash == hash && x.UserId == id && x.SessionId == session
            && x.SessionVersion == version && x.Purpose == "step_up" && x.UsedAt == null && x.ExpiresAt > now);
        var reason = await query.Select(x => x.Reason).SingleOrDefaultAsync(ct);
        if (reason is null) return null;
        return await query.ExecuteUpdateAsync(s => s.SetProperty(x => x.UsedAt, now), ct) == 1 ? reason : null;
    }

    public async Task<bool> VerifyAsync(User user, string? code, string? recovery, bool allowPending, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        if (user.TotpLockedUntil > now) return false;
        var valid = false;
        if (user.TotpSecretEnc is not null && (allowPending || user.TotpEnabledAt is not null))
        {
            if (code is not null && recovery is null)
            {
                var secret = Convert.FromBase64String(protector.Unprotect(user.TotpSecretEnc));
                try
                {
                    if (TotpAlgorithm.Match(secret, code, now, user.TotpLastStep) is { } step)
                    {
                        user.TotpLastStep = step;
                        valid = true;
                    }
                }
                finally { CryptographicOperations.ZeroMemory(secret); }
            }
            else if (!allowPending && code is null && NormalizeRecovery(recovery) is { Length: 20 } normalized)
            {
                recovery = normalized;
                var rows = await db.TotpRecoveryCodes.Where(x => x.UserId == user.Id && x.UsedAt == null).ToListAsync(ct);
                TotpRecoveryCode? found = null;
                foreach (var row in rows)
                    if (hashes.Matches(row.Id, "totp_recovery", recovery, row.CodeHash)) found = row;
                if (found is not null) { found.UsedAt = now; valid = true; }
            }
        }
        if (valid) return true;
        if (user.TotpFailureWindowAt is null || user.TotpFailureWindowAt <= now.AddMinutes(-15))
        {
            user.TotpFailureWindowAt = now;
            user.TotpFailedAttempts = 0;
        }
        user.TotpFailedAttempts++;
        Audit(user.Id, "totp.failure", "user", user.Id);
        if (user.TotpFailedAttempts >= 5)
        {
            user.TotpLockedUntil = now.AddMinutes(15);
            Audit(user.Id, "totp.failure_lockout", "user", user.Id);
        }
        return false;
    }

    private string NewToken(User user, Guid session, string purpose, string? reason, DateTimeOffset authTime, string? authMethod = null)
    {
        var token = RefreshTokens.NewToken();
        db.AdminAccessTokens.Add(new AdminAccessToken
        {
            UserId = user.Id,
            SessionId = session,
            SessionVersion = user.SessionVersion,
            Purpose = purpose,
            TokenHash = RefreshTokens.Hash(token),
            Reason = reason,
            AuthTime = authTime,
            AuthMethod = authMethod,
            ExpiresAt = clock.GetUtcNow().AddMinutes(5),
        });
        return token;
    }

    private async Task<IResult> FailedAsync(Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction tx, CancellationToken ct)
    {
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Error(403, "totp_invalid");
    }

    public void Audit(Guid actor, string action, string type, Guid? target, object? details = null) => db.AuditLogs.Add(new AuditLog
    {
        ActorId = actor,
        Action = action,
        TargetType = type,
        TargetId = target,
        DetailsJson = details is null ? null : JsonSerializer.Serialize(details),
    });

    // Recovery codes are shown as uppercase hex; accept the same code typed in lowercase or grouped.
    private static string? NormalizeRecovery(string? value) =>
        value?.Replace(" ", "", StringComparison.Ordinal).Replace("-", "", StringComparison.Ordinal).ToUpperInvariant();

    public static bool ReasonValid(string? reason, int max) => reason?.Trim().Length is >= 10 && reason.Trim().Length <= max
        && !reason.Any(char.IsControl);
    public static Guid UserId(ClaimsPrincipal principal) => ActorFactory.FromPrincipal(principal).UserId ?? Guid.Empty;
    public static IResult Error(int status, string code) => AuthHandlers.Problem(status, code, code.Replace('_', ' '));
}
