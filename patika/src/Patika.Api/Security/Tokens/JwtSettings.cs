using System.Security.Cryptography;
using Microsoft.IdentityModel.Tokens;

namespace Patika.Api.Security.Tokens;

/// <summary>
/// Access-token settings bound from the <c>Jwt</c> section. <see cref="SigningKey"/> must come from the
/// environment (<c>Jwt__SigningKey</c>) or user secrets and never from appsettings files. It holds a
/// P-256 private key, either as PEM text or as base64 PKCS#8 DER on a single line.
/// </summary>
public sealed class JwtSettings
{
    public const string SectionName = "Jwt";

    public string Issuer { get; set; } = "patika";

    public string Audience { get; set; } = "patika-api";

    public string? SigningKey { get; set; }

    public int AccessTokenMinutes { get; set; } = 15;

    public int RefreshTokenDays { get; set; } = 30;
}

/// <summary>The ES256 key used to sign and validate access tokens.</summary>
public sealed class JwtSigningKey : IDisposable
{
    private readonly ECDsa ecdsa;

    private JwtSigningKey(ECDsa ecdsa, bool ephemeral)
    {
        this.ecdsa = ecdsa;
        IsEphemeral = ephemeral;
        var parameters = ecdsa.ExportParameters(false);
        var keyId = Base64UrlEncoder.Encode(SHA256.HashData([.. parameters.Q.X!, .. parameters.Q.Y!]))[..16];
        // A per-instance provider factory keeps cached signature providers from outliving this key.
        SecurityKey = new ECDsaSecurityKey(ecdsa) { KeyId = keyId, CryptoProviderFactory = new CryptoProviderFactory() };
        Credentials = new SigningCredentials(SecurityKey, SecurityAlgorithms.EcdsaSha256);
    }

    public bool IsEphemeral { get; }

    public ECDsaSecurityKey SecurityKey { get; }

    public SigningCredentials Credentials { get; }

    public static JwtSigningKey Create(string? configuredKey, bool allowEphemeral)
    {
        if (string.IsNullOrWhiteSpace(configuredKey))
        {
            if (!allowEphemeral)
            {
                throw new InvalidOperationException(
                    "Jwt:SigningKey is not configured. Provide a P-256 private key through the environment or user secrets.");
            }

            return new JwtSigningKey(ECDsa.Create(ECCurve.NamedCurves.nistP256), ephemeral: true);
        }

        var ecdsa = ECDsa.Create();
        try
        {
            var trimmed = configuredKey.Trim();
            if (trimmed.StartsWith("-----", StringComparison.Ordinal))
            {
                ecdsa.ImportFromPem(trimmed);
            }
            else
            {
                ecdsa.ImportPkcs8PrivateKey(Convert.FromBase64String(trimmed), out _);
            }

            if (ecdsa.KeySize != 256)
            {
                throw new InvalidOperationException("Jwt:SigningKey must be a P-256 key for ES256.");
            }
        }
        catch (Exception exception) when (exception is CryptographicException or FormatException or ArgumentException)
        {
            ecdsa.Dispose();
            throw new InvalidOperationException("Jwt:SigningKey could not be read as a P-256 private key.", exception);
        }

        return new JwtSigningKey(ecdsa, ephemeral: false);
    }

    public void Dispose() => ecdsa.Dispose();
}
