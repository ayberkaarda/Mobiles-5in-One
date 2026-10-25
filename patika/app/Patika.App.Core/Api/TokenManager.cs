using System.Buffers.Text;
using System.Text.Json;
using Patika.Contracts.Auth;

namespace Patika.App.Core.Api;

/// <summary>A token together with the session generation it belongs to.</summary>
public readonly record struct SessionToken(string? Token, long Generation);

/// <summary>What a background job (the outbox) is allowed to act for: one account in one session.</summary>
public sealed record SessionBinding(long Generation, string UserId);

/// <summary>
/// Holds the access token in memory and the refresh token in <see cref="ITokenStore"/>.
/// Refresh is single-flight: refresh tokens rotate and the API revokes the whole family when one is
/// reused, so concurrent callers must share one exchange instead of each spending the same token.
/// Every session boundary (sign-in, sign-out, expiry) bumps <see cref="Generation"/>; all writes to memory
/// and storage, and the generation check before them, happen under one async lock, so a refresh that
/// finishes after a sign-out or an account switch is discarded instead of writing old tokens back.
/// </summary>
public sealed class TokenManager(ITokenStore store, TimeProvider clock)
{
    /// <summary>Treat the access token as expired this long before it is, so it does not lapse in flight.</summary>
    internal static readonly TimeSpan ExpirySkew = TimeSpan.FromSeconds(30);

    private readonly Lock gate = new();
    private readonly SemaphoreSlim writes = new(1, 1);
    private readonly List<Func<Task>> signOutHooks = [];
    private string? accessToken;
    private DateTimeOffset accessExpiresAt;
    private string? userId;
    private long generation;
    private Task<SessionToken>? refreshing;

    /// <summary>Raised once when a session ends without the user asking: refresh rejected or 401 after refresh.</summary>
    public event EventHandler? SessionExpired;

    /// <summary>Raised after any session starts (sign-in, verification, Google).</summary>
    public event EventHandler? SignedIn;

    /// <summary>Raised after the user signs out, the tokens are wiped and every sign-out hook has finished.</summary>
    public event EventHandler? SignedOut;

    /// <summary>The <c>sub</c> of the current account, from memory or the stored session.</summary>
    public string? UserId
    {
        get
        {
            lock (gate)
            {
                return userId;
            }
        }
    }

    /// <summary>Changes at every session boundary; equal values mean the same session of the same account.</summary>
    public long Generation
    {
        get
        {
            lock (gate)
            {
                return generation;
            }
        }
    }

    /// <summary>The access token if it is still fresh, otherwise null.</summary>
    public string? CurrentAccessToken => Current().Token;

    /// <summary>The fresh access token (or null) and its generation, read together.</summary>
    public SessionToken Current()
    {
        lock (gate)
        {
            return new SessionToken(IsFresh() ? accessToken : null, generation);
        }
    }

    /// <summary>The account and session a background job should stay bound to, or null when signed out.</summary>
    public SessionBinding? Bind()
    {
        lock (gate)
        {
            return userId is null ? null : new SessionBinding(generation, userId);
        }
    }

    /// <summary>Work that must finish before sign-out completes (wiping local data). Runs in order.</summary>
    public void OnSigningOut(Func<Task> hook)
    {
        lock (gate)
        {
            signOutHooks.Add(hook);
        }
    }

    /// <summary>Loads the stored account id at start-up; true when a refresh token exists.</summary>
    public async Task<bool> RestoreAsync()
    {
        await writes.WaitAsync().ConfigureAwait(false);
        try
        {
            var stored = await store.GetAsync().ConfigureAwait(false);
            lock (gate)
            {
                userId ??= stored?.UserId;
            }

            return stored is not null;
        }
        finally
        {
            writes.Release();
        }
    }

    /// <summary>Starts a new session (sign-in, verification). Any refresh still running for the old one is discarded.</summary>
    public async Task AcceptAsync(TokenResponse tokens)
    {
        await writes.WaitAsync().ConfigureAwait(false);
        try
        {
            lock (gate)
            {
                generation++;
                userId = null;
            }

            await SaveLockedAsync(tokens).ConfigureAwait(false);
        }
        finally
        {
            writes.Release();
        }

        SignedIn?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>
    /// A fresh access token. <paramref name="rejected"/> is the token the server just answered 401 to:
    /// if another caller already replaced it, the new one is returned without another exchange.
    /// The token is null when there is no session, the server rejected the refresh token, or the session
    /// changed while the exchange ran.
    /// </summary>
    public Task<SessionToken> RefreshAsync(
        string? rejected,
        Func<string, CancellationToken, Task<TokenResponse>> exchange,
        CancellationToken cancellationToken)
    {
        Task<SessionToken> shared;
        lock (gate)
        {
            if (accessToken is not null && IsFresh() && !string.Equals(accessToken, rejected, StringComparison.Ordinal))
            {
                return Task.FromResult(new SessionToken(accessToken, generation));
            }

            if (refreshing is null || refreshing.IsCompleted)
            {
                if (rejected is not null && string.Equals(accessToken, rejected, StringComparison.Ordinal))
                {
                    accessToken = null;
                }

                refreshing = ExchangeAsync(exchange, generation);
            }

            shared = refreshing;
        }

        // A caller giving up must not cancel the exchange the others are waiting on.
        return shared.WaitAsync(cancellationToken);
    }

    /// <summary>Wipes both tokens because the user signed out, then runs the sign-out hooks.</summary>
    public async Task SignOutAsync()
    {
        await EndAsync(onlyIf: null).ConfigureAwait(false);
        Func<Task>[] hooks;
        lock (gate)
        {
            hooks = [.. signOutHooks];
        }

        foreach (var hook in hooks)
        {
            await hook().ConfigureAwait(false);
        }

        SignedOut?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>
    /// Wipes both tokens because the server no longer accepts them. With <paramref name="onlyIf"/> the wipe
    /// happens only while that generation is current, so a late failure cannot end a newer session.
    /// </summary>
    public async Task ExpireAsync(long? onlyIf = null)
    {
        if (await EndAsync(onlyIf).ConfigureAwait(false))
        {
            SessionExpired?.Invoke(this, EventArgs.Empty);
        }
    }

    public async Task<string?> GetRefreshTokenAsync() => (await store.GetAsync().ConfigureAwait(false))?.RefreshToken;

    private async Task<SessionToken> ExchangeAsync(Func<string, CancellationToken, Task<TokenResponse>> exchange, long startedIn)
    {
        // Leave the caller's lock before touching storage or the network.
        await Task.Yield();
        var stored = await store.GetAsync().ConfigureAwait(false);
        if (stored is null || Generation != startedIn)
        {
            return new SessionToken(null, startedIn);
        }

        TokenResponse tokens;
        try
        {
            tokens = await exchange(stored.RefreshToken, CancellationToken.None).ConfigureAwait(false);
        }
        catch (ApiException e) when (e.Kind is ApiErrorKind.Client or ApiErrorKind.SignInRequired && !e.IsTransient)
        {
            // refresh_invalid, refresh_reused or a malformed token: this session is over.
            await ExpireAsync(onlyIf: startedIn).ConfigureAwait(false);
            return new SessionToken(null, startedIn);
        }

        await writes.WaitAsync().ConfigureAwait(false);
        try
        {
            if (Generation != startedIn)
            {
                // Signed out or switched account while the exchange ran: the result belongs to nobody.
                return new SessionToken(null, startedIn);
            }

            await SaveLockedAsync(tokens).ConfigureAwait(false);
            return new SessionToken(tokens.AccessToken, startedIn);
        }
        finally
        {
            writes.Release();
        }
    }

    /// <summary>Caller holds <see cref="writes"/>.</summary>
    private async Task SaveLockedAsync(TokenResponse tokens)
    {
        var subject = ReadSubject(tokens.AccessToken);
        string? owner;
        lock (gate)
        {
            accessToken = tokens.AccessToken;
            accessExpiresAt = clock.GetUtcNow().AddSeconds(tokens.ExpiresIn);
            userId = subject ?? userId;
            owner = userId;
        }

        await store.SetAsync(new StoredSession(tokens.RefreshToken, owner)).ConfigureAwait(false);
    }

    private async Task<bool> EndAsync(long? onlyIf)
    {
        await writes.WaitAsync().ConfigureAwait(false);
        try
        {
            lock (gate)
            {
                if (onlyIf is { } expected && expected != generation)
                {
                    return false;
                }

                generation++;
                accessToken = null;
                accessExpiresAt = default;
                userId = null;
            }

            await store.ClearAsync().ConfigureAwait(false);
            return true;
        }
        finally
        {
            writes.Release();
        }
    }

    private bool IsFresh() => accessToken is not null && clock.GetUtcNow() < accessExpiresAt - ExpirySkew;

    /// <summary>The <c>sub</c> claim of a JWT, read without validating it (the server does that).</summary>
    internal static string? ReadSubject(string jwt)
    {
        var parts = jwt.Split('.');
        if (parts.Length != 3)
        {
            return null;
        }

        try
        {
            var payload = Base64Url.DecodeFromChars(parts[1]);
            using var document = JsonDocument.Parse(payload);
            return document.RootElement.TryGetProperty("sub", out var sub) && sub.ValueKind == JsonValueKind.String
                ? sub.GetString()
                : null;
        }
        catch (Exception e) when (e is FormatException or JsonException)
        {
            return null;
        }
    }
}
