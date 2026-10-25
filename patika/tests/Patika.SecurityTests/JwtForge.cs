using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Patika.Api.Security.Tokens;
using Patika.Api.Tests.Infrastructure;
using Patika.Domain.Security;

namespace Patika.SecurityTests;

/// <summary>Builds access tokens the way an attacker would, with full control over every field.</summary>
public static class JwtForge
{
    public const string Issuer = "patika";
    public const string Audience = "patika-api";

    public static JwtSigningKey ServerKey() => JwtSigningKey.Create(PatikaApiFactory.SigningKey, allowEphemeral: false);

    public static JwtSigningKey AttackerKey() => JwtSigningKey.Create(PatikaApiFactory.CreateSigningKey(), allowEphemeral: false);

    public static string Sign(
        Guid userId,
        ActorRole role,
        JwtSigningKey key,
        string issuer = Issuer,
        string audience = Audience,
        DateTime? expires = null,
        string tokenType = PatikaClaims.AccessTokenType,
        IEnumerable<Claim>? extraClaims = null)
    {
        var now = DateTime.UtcNow;
        return Create(new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Audience = audience,
            IssuedAt = (expires ?? now.AddMinutes(10)).AddMinutes(-15),
            NotBefore = (expires ?? now.AddMinutes(10)).AddMinutes(-15),
            Expires = expires ?? now.AddMinutes(10),
            TokenType = tokenType,
            SigningCredentials = key.Credentials,
            Subject = Identity(userId, role, extraClaims),
        });
    }

    /// <summary>The ways a naive verifier might turn the server's public key into an HMAC secret.</summary>
    public static readonly string[] PublicKeyRepresentations = ["spki-der", "spki-pem", "raw-point"];

    public static byte[] PublicKeyBytes(string representation)
    {
        var ecdsa = ServerKey().SecurityKey.ECDsa;
        var point = ecdsa.ExportParameters(false).Q;
        return representation switch
        {
            "spki-der" => ecdsa.ExportSubjectPublicKeyInfo(),
            "spki-pem" => Encoding.ASCII.GetBytes(ecdsa.ExportSubjectPublicKeyInfoPem()),
            "raw-point" => [0x04, .. point.X!, .. point.Y!],
            _ => throw new ArgumentOutOfRangeException(nameof(representation)),
        };
    }

    /// <summary>HS256 keyed with a real representation of the server's public key (algorithm confusion).</summary>
    public static string SignWithPublicKeyAsHmac(Guid userId, ActorRole role, string representation)
    {
        var secret = new SymmetricSecurityKey(PublicKeyBytes(representation));
        return Create(new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Audience,
            Expires = DateTime.UtcNow.AddMinutes(10),
            TokenType = PatikaClaims.AccessTokenType,
            SigningCredentials = new SigningCredentials(secret, SecurityAlgorithms.HmacSha256),
            Subject = Identity(userId, role),
        });
    }

    /// <summary>
    /// A deliberately vulnerable control: it accepts whatever algorithm the header names and uses the
    /// public key bytes as the key. A fixture that this validator rejects would prove nothing.
    /// </summary>
    public static async Task<bool> VulnerableValidatorAcceptsAsync(string token, string representation)
    {
        var result = await new JsonWebTokenHandler().ValidateTokenAsync(token, new TokenValidationParameters
        {
            ValidIssuer = Issuer,
            ValidAudience = Audience,
            IssuerSigningKey = new SymmetricSecurityKey(PublicKeyBytes(representation)),
            ValidTypes = [PatikaClaims.AccessTokenType],
        });
        return result.IsValid;
    }

    /// <summary>An unsigned token with <c>alg: none</c>.</summary>
    public static string Unsigned(Guid userId, ActorRole role)
    {
        static string Encode(string json) => Base64UrlEncoder.Encode(Encoding.UTF8.GetBytes(json));
        var exp = DateTimeOffset.UtcNow.AddMinutes(10).ToUnixTimeSeconds();
        var header = Encode("{\"alg\":\"none\",\"typ\":\"at+jwt\"}");
        var payload = Encode(
            $"{{\"sub\":\"{userId}\",\"role\":\"{role}\",\"iss\":\"{Issuer}\",\"aud\":\"{Audience}\",\"exp\":{exp}}}");
        return $"{header}.{payload}.";
    }

    /// <summary>Takes a genuine token and swaps its payload while keeping the original signature.</summary>
    public static string SwapPayload(string genuineToken, Guid userId, ActorRole role)
    {
        var parts = genuineToken.Split('.');
        var exp = DateTimeOffset.UtcNow.AddMinutes(10).ToUnixTimeSeconds();
        var payload = Base64UrlEncoder.Encode(Encoding.UTF8.GetBytes(
            $"{{\"sub\":\"{userId}\",\"role\":\"{role}\",\"iss\":\"{Issuer}\",\"aud\":\"{Audience}\",\"exp\":{exp}}}"));
        return $"{parts[0]}.{payload}.{parts[2]}";
    }

    private static string Create(SecurityTokenDescriptor descriptor) =>
        new JsonWebTokenHandler { SetDefaultTimesOnTokenCreation = false }.CreateToken(descriptor);

    private static ClaimsIdentity Identity(Guid userId, ActorRole role, IEnumerable<Claim>? extra = null) => new(
    [
        new Claim(PatikaClaims.Subject, userId.ToString()),
        new Claim(PatikaClaims.Role, role.ToString()),
        .. extra ?? Enumerable.Empty<Claim>(),
    ]);
}
