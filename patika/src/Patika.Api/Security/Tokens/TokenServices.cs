using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Patika.Domain.Security;

namespace Patika.Api.Security.Tokens;

public static class PatikaClaims
{
    public const string Subject = "sub";
    public const string Role = "role";
    public const string AccessTokenType = "at+jwt";
    public const string AuthTime = "auth_time";
    public const string AuthMethod = "amr";

    // Values for the amr claim (RFC 8176 where one exists).
    public const string PasswordMethod = "pwd";
    public const string ExternalMethod = "fed";
    public const string EmailLinkMethod = "email";
}

public interface IAccessTokenIssuer
{
    /// <summary>
    /// Issues an access token. <paramref name="authMethod"/> is set only for tokens minted by an
    /// interactive sign-in; it adds <c>amr</c> and <c>auth_time</c>. Refreshed tokens carry neither,
    /// so they can never satisfy a recent-authentication check.
    /// </summary>
    (string Token, int ExpiresInSeconds) Issue(Guid userId, ActorRole role, string? authMethod = null);
}

public sealed class AccessTokenIssuer(JwtSigningKey key, IOptions<JwtSettings> settings, TimeProvider clock)
    : IAccessTokenIssuer
{
    private readonly JsonWebTokenHandler handler = new() { SetDefaultTimesOnTokenCreation = false };

    public (string Token, int ExpiresInSeconds) Issue(Guid userId, ActorRole role, string? authMethod = null)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var lifetime = TimeSpan.FromMinutes(settings.Value.AccessTokenMinutes);
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = settings.Value.Issuer,
            Audience = settings.Value.Audience,
            IssuedAt = now,
            NotBefore = now,
            Expires = now + lifetime,
            TokenType = PatikaClaims.AccessTokenType,
            SigningCredentials = key.Credentials,
            Subject = new ClaimsIdentity(
            [
                new Claim(PatikaClaims.Subject, userId.ToString()),
                new Claim(PatikaClaims.Role, role.ToString()),
                new Claim("jti", Guid.NewGuid().ToString("N")),
            ]),
        };
        if (authMethod is not null)
        {
            descriptor.Subject.AddClaim(new Claim(PatikaClaims.AuthMethod, authMethod));
            descriptor.Subject.AddClaim(new Claim(PatikaClaims.AuthTime,
                new DateTimeOffset(now).ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture),
                ClaimValueTypes.Integer64));
        }

        return (handler.CreateToken(descriptor), (int)lifetime.TotalSeconds);
    }

    public static TokenValidationParameters ValidationParameters(JwtSigningKey key, JwtSettings settings) => new()
    {
        ValidIssuer = settings.Issuer,
        ValidAudience = settings.Audience,
        IssuerSigningKey = key.SecurityKey,
        ValidAlgorithms = [SecurityAlgorithms.EcdsaSha256],
        ValidTypes = [PatikaClaims.AccessTokenType],
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        RequireExpirationTime = true,
        RequireSignedTokens = true,
        ClockSkew = TimeSpan.FromSeconds(30),
        NameClaimType = PatikaClaims.Subject,
        RoleClaimType = PatikaClaims.Role,
    };
}

/// <summary>Opaque refresh tokens: 32 random bytes, base64url, stored only as a SHA-256 digest.</summary>
public static class RefreshTokens
{
    public const int TokenLength = 43;

    public static string NewToken() => Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(32));

    public static byte[] Hash(string token) => SHA256.HashData(Encoding.ASCII.GetBytes(token));

    public static bool LooksValid(string? token) =>
        token is { Length: TokenLength } && token.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');
}
