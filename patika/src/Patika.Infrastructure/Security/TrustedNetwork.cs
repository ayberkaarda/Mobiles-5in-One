using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Patika.Infrastructure.Security;

/// <summary>
/// The Web admin console as a trusted client-address source. <see cref="Address"/> is the normalized (IPv6-mapped)
/// socket address of the console and <see cref="Key"/> the shared key; both null when the feature is off.
/// </summary>
public sealed record BffSettings(IPAddress? Address, string? Key)
{
    public bool Enabled => Address is not null && Key is not null;
}

public static class TrustedNetwork
{
    public const string ClientHeader = "X-Patika-Client-Ip";
    public const string KeyHeader = "X-Patika-Bff-Key";

    /// <summary>At least 32 characters: a short shared key is a guessable one.</summary>
    public const int MinimumKeyLength = 32;

    public static IServiceCollection AddTrustedNetwork(this IServiceCollection services, IConfiguration configuration)
    {
        var entries = configuration.GetSection("Network:TrustedProxies").Get<string[]>() ?? [];
        services.Configure<ForwardedHeadersOptions>(options =>
        {
            options.KnownProxies.Clear();
            options.KnownIPNetworks.Clear();
            foreach (var entry in entries.Where(e => !string.IsNullOrWhiteSpace(e)))
            {
                if (entry.Contains('/')) options.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(entry));
                else options.KnownProxies.Add(IPAddress.Parse(entry));
            }
            options.ForwardLimit = 1;
            options.ForwardedHeaders = options.KnownProxies.Count + options.KnownIPNetworks.Count == 0
                ? ForwardedHeaders.None : ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        });
        return services;
    }

    /// <summary>
    /// Reads and validates <c>Network:BffAddress</c> and <c>Network:BffSharedKey</c> (API side). Both or neither;
    /// the address must be a literal IPv4 or IPv6 address (a host name never matches a socket peer) and the key at
    /// least <see cref="MinimumKeyLength"/> characters. Anything else stops the host at startup instead of failing
    /// silently on every request.
    /// </summary>
    public static BffSettings ReadBffSettings(IConfiguration configuration)
    {
        var key = configuration["Network:BffSharedKey"];
        var address = configuration["Network:BffAddress"]?.Trim();
        var hasKey = !string.IsNullOrEmpty(key);
        var hasAddress = !string.IsNullOrEmpty(address);
        if (!hasKey && !hasAddress)
        {
            return new BffSettings(null, null);
        }

        if (hasKey != hasAddress)
        {
            throw new InvalidOperationException("Network:BffAddress and Network:BffSharedKey must be set together.");
        }

        // IPv4 must be in dotted-quad form: "10" or "0x0a000001" parse too but are almost certainly a typo.
        if (!IPAddress.TryParse(address, out var parsed)
            || parsed.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork && parsed.ToString() != address)
        {
            throw new InvalidOperationException("Network:BffAddress must be an IPv4 or IPv6 address, not a host name.");
        }

        ValidateKey(key);
        return new BffSettings(parsed.MapToIPv6(), key);
    }

    /// <summary>Web side: an empty key turns forwarding off; a set key must be long enough.</summary>
    public static string? ReadBffKey(IConfiguration configuration)
    {
        var key = configuration["Network:BffSharedKey"];
        if (string.IsNullOrEmpty(key))
        {
            return null;
        }

        ValidateKey(key);
        return key;
    }

    private static void ValidateKey(string? key)
    {
        if (key is null || key.Length < MinimumKeyLength)
        {
            throw new InvalidOperationException($"Network:BffSharedKey must be at least {MinimumKeyLength} characters.");
        }
    }

    /// <summary>True when this request's client-address claim was verified (the BFF self-check reads it).</summary>
    public static bool BffClaimAccepted(HttpContext context) => context.Items[ClientHeader] is IPAddress;

    // Run before forwarded headers: authentication concerns the socket peer, never a claimed address.
    public static IApplicationBuilder UseBffClientAddress(this IApplicationBuilder app, IConfiguration configuration)
    {
        var settings = ReadBffSettings(configuration);
        if (!settings.Enabled)
        {
            return app;
        }

        var expected = SHA256.HashData(Encoding.UTF8.GetBytes(settings.Key!));
        var logger = app.ApplicationServices.GetRequiredService<ILoggerFactory>().CreateLogger("Patika.Security.Bff");
        return app.Use(async (context, next) =>
        {
            var peer = context.Connection.RemoteIpAddress;
            var keys = context.Request.Headers[KeyHeader];
            var keyValid = keys.Count == 1
                && CryptographicOperations.FixedTimeEquals(expected, SHA256.HashData(Encoding.UTF8.GetBytes(keys.ToString())));
            if (keyValid && peer is not null && !peer.MapToIPv6().Equals(settings.Address))
            {
                // The key is a secret, the mismatch is not: this is a misconfigured BffAddress (or a leaked key).
                logger.LogWarning("A valid BFF key arrived from {Peer}, not from Network:BffAddress {BffAddress}; the client address claim is ignored",
                    peer.ToString(), settings.Address!.IsIPv4MappedToIPv6 ? settings.Address.MapToIPv4().ToString() : settings.Address.ToString());
            }
            else if (keyValid && peer is not null
                && context.Request.Headers[ClientHeader].Count == 1
                && IPAddress.TryParse(context.Request.Headers[ClientHeader].ToString(), out var client))
            {
                context.Items[ClientHeader] = client;
            }

            await next(context);
        });
    }

    public static IApplicationBuilder UseVerifiedClientAddress(this IApplicationBuilder app) => app.Use(async (context, next) =>
    {
        if (context.Items[ClientHeader] is IPAddress client) context.Connection.RemoteIpAddress = client;
        await next(context);
    });
}
