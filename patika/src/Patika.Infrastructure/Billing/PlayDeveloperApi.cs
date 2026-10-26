using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;

namespace Patika.Infrastructure.Billing;

public sealed record OfferDetails(string BasePlanId);
public sealed record AutoRenewingPlan(bool AutoRenewEnabled);
public sealed record PlayLineItem(string ProductId, DateTimeOffset ExpiryTime,
    AutoRenewingPlan? AutoRenewingPlan, OfferDetails? OfferDetails);
public sealed record ExternalAccountIdentifiers(string? ObfuscatedExternalAccountId, string? ObfuscatedExternalProfileId = null);
public sealed record PlaySubscription(PlayLineItem[] LineItems, string SubscriptionState,
    string AcknowledgementState, string? LinkedPurchaseToken = null, JsonElement? TestPurchase = null,
    ExternalAccountIdentifiers? ExternalAccountIdentifiers = null);

/// <summary>Billing policy the API and the Worker share.</summary>
public sealed class BillingOptions
{
    /// <summary>License-tester purchases grant nothing unless this is on (Development, or the local demo).</summary>
    public bool AllowTestPurchases { get; init; }
}

/// <summary>
/// The account id the app hands to Play as <c>obfuscatedExternalAccountId</c>: base64url(HMAC-SHA256(server key, user id)).
/// Play returns it with the purchase, so a token bought for one Patika account cannot be claimed by another.
/// </summary>
public sealed class BillingAccountIds
{
    private readonly byte[] key;

    public BillingAccountIds(byte[] key)
    {
        if (key.Length < 32) throw new InvalidOperationException("Billing:AccountKey must be at least 32 bytes.");
        this.key = key;
    }

    public string For(Guid userId) =>
        Convert.ToBase64String(HMACSHA256.HashData(key, userId.ToByteArray())).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

public interface IPlayDeveloperApi
{
    Task<PlaySubscription> GetSubscriptionV2(string packageName, string purchaseToken, CancellationToken ct = default);
    Task Acknowledge(string packageName, string productId, string purchaseToken, CancellationToken ct = default);
}
public interface IGoogleAccessTokenSource
{
    Task<string> GetAsync(CancellationToken ct);
}

/// <summary>The host supplies a short-lived service-account access token; no credentials ship with the project.</summary>
public sealed class ConfiguredGoogleAccessTokenSource(IConfiguration configuration) : IGoogleAccessTokenSource
{
    public Task<string> GetAsync(CancellationToken ct) => Task.FromResult(
        configuration["Billing:Google:AccessToken"] ?? throw new InvalidOperationException("A service-account bearer is required."));
}

/// <summary>REST transport, not exercised against a Play Console account.</summary>
public sealed class GooglePlayDeveloperApi(HttpClient http, IGoogleAccessTokenSource tokens) : IPlayDeveloperApi
{
    private const string Root = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/";
    public async Task<PlaySubscription> GetSubscriptionV2(string packageName, string purchaseToken, CancellationToken ct = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get,
            Root + Uri.EscapeDataString(packageName) + "/purchases/subscriptionsv2/tokens/" + Uri.EscapeDataString(purchaseToken));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await tokens.GetAsync(ct));
        using var response = await http.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<PlaySubscription>(cancellationToken: ct)
            ?? throw new InvalidOperationException("Empty Play response.");
    }
    public async Task Acknowledge(string packageName, string productId, string purchaseToken, CancellationToken ct = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post,
            Root + Uri.EscapeDataString(packageName) + "/purchases/subscriptions/" + Uri.EscapeDataString(productId)
            + "/tokens/" + Uri.EscapeDataString(purchaseToken) + ":acknowledge")
        { Content = JsonContent.Create(new { }) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await tokens.GetAsync(ct));
        using var response = await http.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
    }
}

public sealed class FakePlayPurchase : Entity
{
    public required string TokenHash { get; set; }
    public required string PackageName { get; set; }
    public required string ResponseJson { get; set; }
}

/// <summary>Database-backed so the API and worker observe the same simulated store.</summary>
public sealed class FakePlayDeveloperApi(PatikaDbContext db, IDataProtectionProvider protection) : IPlayDeveloperApi
{
    private readonly IDataProtector links = protection.CreateProtector("Patika.Play.Fake.LinkedToken.v1");
    public async Task SeedAsync(string packageName, string token, PlaySubscription purchase, CancellationToken ct = default)
    {
        var hash = BillingTokens.Hash(token);
        var row = await db.Set<FakePlayPurchase>().SingleOrDefaultAsync(x => x.TokenHash == hash, ct);
        if (row is null)
        {
            row = new FakePlayPurchase { TokenHash = hash, PackageName = packageName, ResponseJson = "" };
            db.Add(row);
        }
        row.PackageName = packageName;
        row.ResponseJson = JsonSerializer.Serialize(purchase with
        {
            LinkedPurchaseToken = purchase.LinkedPurchaseToken is { } linked ? links.Protect(linked) : null,
        });
        await db.SaveChangesAsync(ct);
    }
    public async Task<PlaySubscription> GetSubscriptionV2(string packageName, string purchaseToken, CancellationToken ct = default)
    {
        var hash = BillingTokens.Hash(purchaseToken);
        var row = await db.Set<FakePlayPurchase>().AsNoTracking().SingleOrDefaultAsync(x => x.TokenHash == hash && x.PackageName == packageName, ct);
        if (row is null) throw new KeyNotFoundException("Purchase unavailable.");
        var purchase = JsonSerializer.Deserialize<PlaySubscription>(row.ResponseJson)!;
        return purchase with
        {
            LinkedPurchaseToken = purchase.LinkedPurchaseToken is { } linked ? links.Unprotect(linked) : null,
        };
    }
    public async Task Acknowledge(string packageName, string productId, string purchaseToken, CancellationToken ct = default)
    {
        var purchase = await GetSubscriptionV2(packageName, purchaseToken, ct);
        await SeedAsync(packageName, purchaseToken, purchase with { AcknowledgementState = "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" }, ct);
    }
}

public static class BillingTokens
{
    public const string Package = "app.patika.android";
    public const string Product = "patika_destekci";
    public static string Hash(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}

public static class BillingRegistration
{
    /// <summary>A slow Play response holds only its own token lock, and for at most this long.</summary>
    public static readonly TimeSpan PlayTimeout = TimeSpan.FromSeconds(10);

    public static IServiceCollection AddPlayBilling(this IServiceCollection services, IConfiguration configuration, bool development, bool production = false)
    {
        var provider = configuration["Billing:Provider"] ?? "Fake";
        if (provider != "Fake" && provider != "Google") throw new InvalidOperationException("Unknown billing provider.");
        // Staging, Testing and every other non-Development host is treated like Production here.
        if (!development && provider == "Fake" && !configuration.GetValue<bool>("Billing:AllowFake"))
            throw new InvalidOperationException("Fake billing requires Billing:AllowFake outside Development.");
        if (provider == "Google" && configuration["Billing:PackageName"] != BillingTokens.Package)
            throw new InvalidOperationException($"Billing:PackageName must be {BillingTokens.Package} for the Google provider.");
        // Purchase tokens are encrypted with the API key ring (ADR-0009); the Worker must read the same ring
        // or reconciliation cannot decrypt them, so Production refuses an ephemeral ring here as well.
        var protection = services.AddDataProtection().SetApplicationName("Patika.Api");
        if (configuration["DataProtection:KeysPath"] is { Length: > 0 } path)
            protection.PersistKeysToFileSystem(new DirectoryInfo(path));
        else if (production)
            throw new InvalidOperationException("DataProtection:KeysPath must point to the persistent key ring shared by the API and Worker.");
        services.TryAddSingleton(TimeProvider.System);
        services.AddSingleton(new BillingOptions
        {
            AllowTestPurchases = configuration.GetValue<bool?>("Billing:AllowTestPurchases") ?? development,
        });
        services.AddScoped<FakePlayDeveloperApi>();
        if (provider == "Fake") services.AddScoped<IPlayDeveloperApi>(sp => sp.GetRequiredService<FakePlayDeveloperApi>());
        else
        {
            services.AddSingleton<IGoogleAccessTokenSource, ConfiguredGoogleAccessTokenSource>();
            // Request paths carry the purchase token, so the default HttpClient request logging stays off.
            services.AddHttpClient<IPlayDeveloperApi, GooglePlayDeveloperApi>(client => client.Timeout = PlayTimeout).RemoveAllLoggers();
        }
        services.AddScoped<SubscriptionService>();
        return services;
    }
}
