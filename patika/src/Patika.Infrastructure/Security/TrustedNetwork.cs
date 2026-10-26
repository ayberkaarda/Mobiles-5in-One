using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Patika.Infrastructure.Security;

public static class TrustedNetwork
{
    public const string ClientHeader = "X-Patika-Client-Ip";
    public const string KeyHeader = "X-Patika-Bff-Key";

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

    // Run before forwarded headers: authentication concerns the socket peer, never a claimed address.
    public static IApplicationBuilder UseBffClientAddress(this IApplicationBuilder app, IConfiguration configuration) =>
        app.Use(async (context, next) =>
        {
            var expected = configuration["Network:BffSharedKey"];
            var address = configuration["Network:BffAddress"];
            var peer = context.Connection.RemoteIpAddress;
            if (!string.IsNullOrEmpty(expected) && IPAddress.TryParse(address, out var bff) && peer is not null
                && peer.MapToIPv6().Equals(bff.MapToIPv6())
                && context.Request.Headers[KeyHeader].Count == 1
                && CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(expected)),
                    SHA256.HashData(Encoding.UTF8.GetBytes(context.Request.Headers[KeyHeader].ToString())))
                && context.Request.Headers[ClientHeader].Count == 1
                && IPAddress.TryParse(context.Request.Headers[ClientHeader].ToString(), out var client))
            {
                context.Items[ClientHeader] = client;
            }
            await next(context);
        });

    public static IApplicationBuilder UseVerifiedClientAddress(this IApplicationBuilder app) => app.Use(async (context, next) =>
    {
        if (context.Items[ClientHeader] is IPAddress client) context.Connection.RemoteIpAddress = client;
        await next(context);
    });
}
