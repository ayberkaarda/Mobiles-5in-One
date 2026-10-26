using System.Security.Cryptography;
using System.Text;
using Patika.Api.Security.Tokens;
using Patika.Infrastructure.Billing;

namespace Patika.Api.Features.Subscriptions;

public static class BillingAccountKey
{
    private static readonly byte[] DerivationInfo = Encoding.ASCII.GetBytes("patika/billing-account/v1");

    /// <summary>
    /// <c>Billing:AccountKey</c> (base64, at least 32 bytes) when set; otherwise HKDF-SHA256 from the JWT signing key, as
    /// the email code key does, so a deployment needs no extra secret. Rotating either key unbinds earlier purchases.
    /// </summary>
    public static IServiceCollection AddBillingAccountIds(this IServiceCollection services, IConfiguration configuration) =>
        services.AddSingleton(provider =>
        {
            if (configuration["Billing:AccountKey"] is { Length: > 0 } configured)
                return new BillingAccountIds(Convert.FromBase64String(configured.Trim()));
            var secret = provider.GetRequiredService<JwtSigningKey>().SecurityKey.ECDsa.ExportParameters(includePrivateParameters: true).D
                ?? throw new InvalidOperationException("The JWT signing key has no private part to derive the billing account key from.");
            try { return new BillingAccountIds(HKDF.DeriveKey(HashAlgorithmName.SHA256, secret, 32, salt: [], info: DerivationInfo)); }
            finally { CryptographicOperations.ZeroMemory(secret); }
        });
}
