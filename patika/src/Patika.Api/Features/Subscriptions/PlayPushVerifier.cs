using System.IdentityModel.Tokens.Jwt;
using Microsoft.IdentityModel.Tokens;

namespace Patika.Api.Features.Subscriptions;

public sealed class PlayPushVerifier(HttpClient http, IConfiguration configuration, TimeProvider clock)
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private IReadOnlyCollection<SecurityKey> keys = [];
    private DateTimeOffset refreshAt;

    public async Task<bool> VerifyAsync(string? authorization, CancellationToken ct)
    {
        if (authorization is null || !authorization.StartsWith("Bearer ", StringComparison.Ordinal)) return false;
        var audience = configuration["Billing:Rtdn:Audience"];
        var email = configuration["Billing:Rtdn:Email"];
        if (string.IsNullOrWhiteSpace(audience) || string.IsNullOrWhiteSpace(email)) return false;
        try
        {
            await LoadKeysAsync(false, ct);
            return Validate(authorization[7..], audience, email);
        }
        catch (SecurityTokenSignatureKeyNotFoundException)
        {
            // A new key id gets one refresh; refresh is throttled to prevent fetch floods.
            try
            {
                await LoadKeysAsync(true, ct);
                return Validate(authorization[7..], audience, email);
            }
            catch (Exception e) when (IsRejection(e)) { return false; }
        }
        catch (Exception e) when (IsRejection(e)) { return false; }
    }

    // An unreachable or malformed key set rejects the delivery (Pub/Sub retries) instead of failing with 500.
    private static bool IsRejection(Exception e) =>
        e is SecurityTokenException or ArgumentException or HttpRequestException or TaskCanceledException or System.Text.Json.JsonException;

    private DateTimeOffset fetchedAt;
    private async Task LoadKeysAsync(bool rotation, CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            if (keys.Count > 0 && clock.GetUtcNow() < refreshAt && (!rotation || clock.GetUtcNow() < fetchedAt.AddMinutes(1))) return;
            var url = configuration["Billing:Rtdn:JwksUrl"] ?? "https://www.googleapis.com/oauth2/v3/certs";
            var jwks = new JsonWebKeySet(await http.GetStringAsync(url, ct));
            keys = jwks.GetSigningKeys().ToArray();
            fetchedAt = clock.GetUtcNow();
            refreshAt = fetchedAt.AddHours(1);
        }
        finally { gate.Release(); }
    }

    private bool Validate(string token, string audience, string email)
    {
        var handler = new JwtSecurityTokenHandler { MapInboundClaims = false };
        var now = clock.GetUtcNow();
        var principal = handler.ValidateToken(token, new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuers = ["accounts.google.com", "https://accounts.google.com"],
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
}
