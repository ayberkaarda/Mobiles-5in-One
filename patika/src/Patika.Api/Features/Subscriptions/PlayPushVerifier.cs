using System.IdentityModel.Tokens.Jwt;
using Microsoft.IdentityModel.Tokens;

namespace Patika.Api.Features.Subscriptions;

/// <summary>
/// Verifies the Google-signed OIDC token on a Play push. The endpoint is anonymous, so a caller must never be able to
/// make it fetch keys at will: tokens that cannot verify are rejected from their header alone, pushes signed with a
/// cached key never wait on a fetch, and fetches (failed ones included) are spaced at least <see cref="RefreshInterval"/>
/// apart with exponential backoff up to <see cref="MaxBackoff"/>.
/// </summary>
public sealed class PlayPushVerifier(HttpClient http, IConfiguration configuration, TimeProvider clock)
{
    public const string DefaultJwksUrl = "https://www.googleapis.com/oauth2/v3/certs";
    public static readonly TimeSpan FetchTimeout = TimeSpan.FromSeconds(5);
    public static readonly TimeSpan RefreshInterval = TimeSpan.FromMinutes(1);
    public static readonly TimeSpan MaxBackoff = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan MaxKeyAge = TimeSpan.FromHours(1);
    private static readonly string[] Issuers = ["accounts.google.com", "https://accounts.google.com"];

    private readonly SemaphoreSlim gate = new(1, 1);
    private volatile KeySnapshot snapshot = new([], DateTimeOffset.MinValue);
    private long nextFetchTicks;
    private int failures;

    /// <summary>Provider=Google must name the push audience, the push service account and the key set explicitly.</summary>
    public static void RequireConfiguration(IConfiguration configuration)
    {
        if ((configuration["Billing:Provider"] ?? "Fake") != "Google") return;
        foreach (var key in new[] { "Billing:Rtdn:Audience", "Billing:Rtdn:Email", "Billing:Rtdn:JwksUrl" })
        {
            if (string.IsNullOrWhiteSpace(configuration[key]))
                throw new InvalidOperationException($"{key} is required when Billing:Provider is Google.");
        }
    }

    public async Task<bool> VerifyAsync(string? authorization, CancellationToken ct)
    {
        if (authorization is null || !authorization.StartsWith("Bearer ", StringComparison.Ordinal)) return false;
        var audience = configuration["Billing:Rtdn:Audience"];
        var email = configuration["Billing:Rtdn:Email"];
        if (string.IsNullOrWhiteSpace(audience) || string.IsNullOrWhiteSpace(email)) return false;
        var token = authorization[7..];
        var kid = Screen(token, audience);
        if (kid is null) return false;

        var current = snapshot;
        if (!current.Has(kid)) current = await RefreshAsync(wait: true, ct);
        // Old keys are re-read now and then by whoever finds the gate free; nobody queues for it.
        else if (clock.GetUtcNow() - current.FetchedAt > MaxKeyAge) current = await RefreshAsync(wait: false, ct);
        if (!current.Has(kid)) return false;
        try { return Validate(token, audience, email, current.Keys); }
        catch (Exception e) when (e is SecurityTokenException or ArgumentException) { return false; }
    }

    /// <summary>Header and claim checks that need no key; returns the key id or null when the token can never verify.</summary>
    private string? Screen(string token, string audience)
    {
        var handler = new JwtSecurityTokenHandler { MapInboundClaims = false };
        if (token.Length > 8192 || !handler.CanReadToken(token)) return null;
        JwtSecurityToken jwt;
        try { jwt = handler.ReadJwtToken(token); }
        catch (Exception e) when (e is ArgumentException or SecurityTokenException) { return null; }
        if (jwt.Header.Alg != SecurityAlgorithms.RsaSha256 || string.IsNullOrEmpty(jwt.Header.Kid)) return null;
        if (!Issuers.Contains(jwt.Issuer, StringComparer.Ordinal) || !jwt.Audiences.Contains(audience, StringComparer.Ordinal)) return null;
        if (jwt.Payload.Expiration is not { } exp || exp < clock.GetUtcNow().AddMinutes(-2).ToUnixTimeSeconds()) return null;
        return jwt.Header.Kid;
    }

    private async Task<KeySnapshot> RefreshAsync(bool wait, CancellationToken ct)
    {
        if (clock.GetUtcNow().UtcTicks < Interlocked.Read(ref nextFetchTicks)) return snapshot;
        if (wait) await gate.WaitAsync(ct);
        else if (!gate.Wait(0)) return snapshot;
        try
        {
            var now = clock.GetUtcNow();
            // Another caller fetched (or tried) while this one waited.
            if (now.UtcTicks < Interlocked.Read(ref nextFetchTicks)) return snapshot;
            // The attempt is counted before it starts, so a cancelled or hanging fetch still spaces out the next one.
            failures++;
            Interlocked.Exchange(ref nextFetchTicks, (now + Backoff(failures)).UtcTicks);
            try
            {
                var url = configuration["Billing:Rtdn:JwksUrl"] ?? DefaultJwksUrl;
                var keys = new JsonWebKeySet(await http.GetStringAsync(url, ct)).GetSigningKeys().ToArray();
                // An empty set is a failed fetch: the last good keys stay.
                if (keys.Length == 0) return snapshot;
                snapshot = new KeySnapshot(keys, now);
                failures = 0;
                Interlocked.Exchange(ref nextFetchTicks, (now + RefreshInterval).UtcTicks);
            }
            catch (Exception e) when (e is not OperationCanceledException || !ct.IsCancellationRequested)
            {
                // Unreachable, timed out or malformed: keep the last good keys and back off.
            }
            return snapshot;
        }
        finally { gate.Release(); }
    }

    private static TimeSpan Backoff(int failed)
    {
        var minutes = Math.Pow(2, Math.Min(failed - 1, 10)) * RefreshInterval.TotalMinutes;
        return TimeSpan.FromMinutes(Math.Min(minutes, MaxBackoff.TotalMinutes));
    }

    private bool Validate(string token, string audience, string email, IReadOnlyCollection<SecurityKey> keys)
    {
        var handler = new JwtSecurityTokenHandler { MapInboundClaims = false };
        var now = clock.GetUtcNow();
        var principal = handler.ValidateToken(token, new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuers = Issuers,
            ValidateAudience = true,
            ValidAudience = audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKeys = keys,
            ValidAlgorithms = [SecurityAlgorithms.RsaSha256],
            RequireExpirationTime = true,
            RequireSignedTokens = true,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(2),
            LifetimeValidator = (nbf, exp, _, _) => exp.HasValue && exp.Value >= now.UtcDateTime.AddMinutes(-2)
                && (!nbf.HasValue || nbf.Value <= now.UtcDateTime.AddMinutes(2)),
        }, out var validated);
        var jwt = (JwtSecurityToken)validated;
        return principal.FindFirst("email")?.Value == email
            && principal.FindFirst("email_verified")?.Value.Equals("true", StringComparison.OrdinalIgnoreCase) == true
            && long.TryParse(principal.FindFirst("iat")?.Value, out var iat)
            && iat <= now.AddMinutes(2).ToUnixTimeSeconds() && iat < jwt.Payload.Expiration;
    }

    private sealed record KeySnapshot(IReadOnlyCollection<SecurityKey> Keys, DateTimeOffset FetchedAt)
    {
        public bool Has(string kid) => Keys.Any(k => string.Equals(k.KeyId, kid, StringComparison.Ordinal));
    }
}
