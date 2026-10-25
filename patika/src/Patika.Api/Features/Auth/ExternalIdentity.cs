using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace Patika.Api.Features.Auth;

public sealed record ExternalIdentity(string Provider, string Subject, string? Email, bool EmailVerified, string? Name);

/// <summary>
/// One abstraction for every external sign-in provider (ADR-0005). Google is implemented now; Apple
/// plugs in later with its own verifier and the same <c>external_logins</c> table.
/// </summary>
public interface IExternalIdentityVerifier
{
    string Provider { get; }

    /// <summary>Returns the verified identity, or <c>null</c> when the token is not acceptable.</summary>
    Task<ExternalIdentity?> VerifyAsync(string token, CancellationToken cancellationToken);
}

public sealed class GoogleSettings
{
    public const string SectionName = "Google";

    /// <summary>OAuth client ids accepted as the ID token <c>aud</c> (the Android client id).</summary>
    public string[] ClientIds { get; set; } = [];
}

public sealed class GoogleIdTokenVerifier(
    IConfigurationManager<OpenIdConnectConfiguration> configurationManager,
    IOptions<GoogleSettings> settings,
    TimeProvider clock,
    ILogger<GoogleIdTokenVerifier> logger) : IExternalIdentityVerifier
{
    public const string ProviderName = "google";
    public const string MetadataAddress = "https://accounts.google.com/.well-known/openid-configuration";
    public static readonly string[] Issuers = ["https://accounts.google.com", "accounts.google.com"];

    private readonly JsonWebTokenHandler handler = new() { MapInboundClaims = false };

    public string Provider => ProviderName;

    public async Task<ExternalIdentity?> VerifyAsync(string token, CancellationToken cancellationToken)
    {
        var audiences = settings.Value.ClientIds.Where(id => !string.IsNullOrWhiteSpace(id)).ToArray();
        if (audiences.Length == 0)
        {
            logger.LogWarning("Google sign-in rejected: no client id is configured");
            return null;
        }

        var result = await ValidateAsync(token, audiences, cancellationToken);
        if (result is { IsValid: false, Exception: SecurityTokenSignatureKeyNotFoundException })
        {
            configurationManager.RequestRefresh();
            result = await ValidateAsync(token, audiences, cancellationToken);
        }

        if (!result.IsValid)
        {
            logger.LogInformation("Google ID token rejected ({Reason})", result.Exception?.GetType().Name ?? "invalid");
            return null;
        }

        var claims = result.ClaimsIdentity;
        var subject = claims.FindFirst("sub")?.Value;
        if (string.IsNullOrWhiteSpace(subject) || subject.Length > 255)
        {
            return null;
        }

        var email = claims.FindFirst("email")?.Value;
        var verified = string.Equals(claims.FindFirst("email_verified")?.Value, "true", StringComparison.OrdinalIgnoreCase);
        return new ExternalIdentity(ProviderName, subject, email, verified && email is not null, claims.FindFirst("name")?.Value);
    }

    private async Task<TokenValidationResult> ValidateAsync(
        string token, string[] audiences, CancellationToken cancellationToken)
    {
        var configuration = await configurationManager.GetConfigurationAsync(cancellationToken);
        var parameters = new TokenValidationParameters
        {
            ValidIssuers = Issuers,
            ValidAudiences = audiences,
            IssuerSigningKeys = configuration.SigningKeys,
            ValidAlgorithms = [SecurityAlgorithms.RsaSha256],
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            RequireExpirationTime = true,
            RequireSignedTokens = true,
            ClockSkew = TimeSpan.FromMinutes(1),
            LifetimeValidator = (notBefore, expires, _, p) =>
            {
                var now = clock.GetUtcNow().UtcDateTime;
                return expires is { } exp && exp.ToUniversalTime() + p.ClockSkew > now
                    && (notBefore is not { } nbf || nbf.ToUniversalTime() - p.ClockSkew <= now);
            },
        };
        return await handler.ValidateTokenAsync(token, parameters);
    }

    public static IConfigurationManager<OpenIdConnectConfiguration> CreateConfigurationManager() =>
        new ConfigurationManager<OpenIdConnectConfiguration>(
            MetadataAddress, new OpenIdConnectConfigurationRetriever(), new HttpDocumentRetriever { RequireHttps = true });
}
