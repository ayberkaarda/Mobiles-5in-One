using System.Collections.Concurrent;
using System.Globalization;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;
using Patika.Api.Security.Authorization;
using Patika.Api.Security.Tokens;

namespace Patika.Api.Features.Auth;

/// <summary>
/// Process-wide cache of <c>users.session_version</c> per user, kept for at most <see cref="Lifetime"/>.
/// This process drops an entry as soon as it changes the version itself, so a token that went stale
/// here is rejected on the very next request; another instance's change is seen within the lifetime.
/// </summary>
public sealed class SessionVersionCache(TimeProvider clock)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(30);

    /// <summary>Shared by the token check and the handlers that change a version.</summary>
    public static SessionVersionCache Shared { get; } = new(TimeProvider.System);

    private readonly ConcurrentDictionary<Guid, (int Version, long StoredAt)> entries = new();

    public int? Get(Guid userId) =>
        entries.TryGetValue(userId, out var entry) && clock.GetElapsedTime(entry.StoredAt) < Lifetime
            ? entry.Version
            : null;

    public void Set(Guid userId, int version) => entries[userId] = (version, clock.GetTimestamp());

    public void Invalidate(Guid userId) => entries.TryRemove(userId, out _);
}

/// <summary>
/// Rejects an access token whose <c>sv</c> claim differs from the account's current session version.
/// A token without the claim counts as version 0 (only tokens minted before the claim existed).
/// </summary>
public static class SessionVersionCheck
{
    /// <summary>Chains the check after the existing <c>OnTokenValidated</c> handler of the JWT bearer scheme.</summary>
    public static IServiceCollection AddPatikaSessionVersionCheck(this IServiceCollection services)
    {
        services.AddSingleton<IPostConfigureOptions<JwtBearerOptions>, ChainCheck>();
        return services;
    }

    public static async Task<bool> IsCurrentAsync(
        System.Security.Claims.ClaimsPrincipal principal, IAuthStore store, SessionVersionCache cache,
        CancellationToken cancellationToken)
    {
        if (ActorFactory.FromPrincipal(principal).UserId is not { } userId)
        {
            return false;
        }

        var claim = principal.FindFirst(PatikaClaims.SessionVersion)?.Value;
        var presented = 0;
        if (claim is not null && !int.TryParse(claim, NumberStyles.None, CultureInfo.InvariantCulture, out presented))
        {
            return false;
        }

        if (cache.Get(userId) == presented)
        {
            return true;
        }

        // A miss or a different cached value: ask the database (the token may be newer than the cache).
        if (await store.GetSessionVersionAsync(userId, cancellationToken) is not { } current)
        {
            cache.Invalidate(userId);
            return false;
        }

        cache.Set(userId, current);
        return current == presented;
    }

    private sealed class ChainCheck : IPostConfigureOptions<JwtBearerOptions>
    {
        public void PostConfigure(string? name, JwtBearerOptions options)
        {
            if (name != JwtBearerDefaults.AuthenticationScheme)
            {
                return;
            }

            options.Events ??= new JwtBearerEvents();
            var previous = options.Events.OnTokenValidated;
            options.Events.OnTokenValidated = async context =>
            {
                await previous(context);
                if (context.Result is { Failure: not null } || context.Principal is null)
                {
                    return;
                }

                var store = context.HttpContext.RequestServices.GetRequiredService<IAuthStore>();
                if (!await IsCurrentAsync(context.Principal, store, SessionVersionCache.Shared, context.HttpContext.RequestAborted))
                {
                    context.Fail("Session is no longer valid.");
                }
            };
        }
    }
}
