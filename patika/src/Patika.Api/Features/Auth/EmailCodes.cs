using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using Patika.Api.Security.RateLimiting;
using Patika.Api.Security.Tokens;

namespace Patika.Api.Features.Auth;

/// <summary>
/// Optional dedicated key for email codes. When <see cref="Key"/> is empty, the key is derived with
/// HKDF-SHA256 from the JWT signing key, so a deployment needs no extra secret.
/// </summary>
public sealed class EmailCodeSettings
{
    public const string SectionName = "Auth:EmailCodes";

    /// <summary>Base64, at least 32 bytes (env <c>Auth__EmailCodes__Key</c>).</summary>
    public string? Key { get; set; }
}

/// <summary>
/// Six-digit email codes for address verification and password reset. A code is stored only as
/// HMAC-SHA256 under a server key, bound to its purpose and row id, so a database copy cannot be
/// brute forced offline over the million possible codes. Each code lives 15 minutes and is burned
/// after <see cref="MaxAttempts"/> wrong guesses.
/// </summary>
public sealed class EmailCodeHasher
{
    public const int Length = 6;

    public const int MaxAttempts = 5;

    /// <summary>Persistent cap: codes issued per user and purpose within <see cref="IssueWindow"/>.</summary>
    public const int MaxIssuedPerWindow = 10;

    public static readonly TimeSpan IssueWindow = TimeSpan.FromHours(24);

    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(15);

    private static readonly byte[] DerivationInfo = Encoding.ASCII.GetBytes("patika/email-code/v1");

    private readonly byte[] key;

    public EmailCodeHasher(IOptions<EmailCodeSettings> settings, JwtSigningKey signingKey)
        : this(ResolveKey(settings.Value.Key, signingKey))
    {
    }

    internal EmailCodeHasher(byte[] key)
    {
        if (key.Length < 32)
        {
            throw new InvalidOperationException("Auth:EmailCodes:Key must be at least 32 bytes.");
        }

        this.key = key;
    }

    public static string NewCode() =>
        RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6", CultureInfo.InvariantCulture);

    public static bool LooksValid(string? code) => code is { Length: Length } && code.All(char.IsAsciiDigit);

    public byte[] Hash(Guid codeId, string purpose, string code) =>
        HMACSHA256.HashData(key, Encoding.UTF8.GetBytes($"{purpose}\n{codeId:N}\n{code}"));

    /// <summary>Constant-time comparison of a presented code with a stored digest.</summary>
    public bool Matches(Guid codeId, string purpose, string code, byte[] storedHash) =>
        CryptographicOperations.FixedTimeEquals(Hash(codeId, purpose, code), storedHash);

    private static byte[] ResolveKey(string? configured, JwtSigningKey signingKey)
    {
        if (!string.IsNullOrWhiteSpace(configured))
        {
            return Convert.FromBase64String(configured.Trim());
        }

        var secret = signingKey.SecurityKey.ECDsa.ExportParameters(includePrivateParameters: true).D
            ?? throw new InvalidOperationException("The JWT signing key has no private part to derive the email code key from.");
        try
        {
            return HKDF.DeriveKey(HashAlgorithmName.SHA256, secret, 32, salt: [], info: DerivationInfo);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(secret);
        }
    }
}

/// <summary>Verification resend: 3 per 15 minutes per normalized email (the IP side uses the auth policy).</summary>
public sealed class EmailCodeResendLimiter : IDisposable
{
    public KeyedRateLimiter Limiter { get; } = new(3, TimeSpan.FromMinutes(15), 15);

    public void Dispose() => Limiter.Dispose();
}

public static class EmailCodeServices
{
    public static IServiceCollection AddPatikaEmailCodes(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<EmailCodeSettings>().Bind(configuration.GetSection(EmailCodeSettings.SectionName));
        services.AddSingleton<EmailCodeHasher>();
        services.AddSingleton<EmailCodeResendLimiter>();
        return services;
    }
}
