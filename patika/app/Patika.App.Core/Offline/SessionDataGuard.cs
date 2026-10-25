using Patika.App.Core.Api;

namespace Patika.App.Core.Offline;

/// <summary>
/// Keeps local data tied to the account: sign-out wipes the outbox and the map cache before
/// <see cref="TokenManager.SignOutAsync"/> returns (the cache also refuses writes started before the wipe);
/// signing in as a different account drops records the previous one left. A session that merely expired
/// keeps the outbox so the same user can sign in again and still send it.
/// </summary>
public sealed class SessionDataGuard : IDisposable
{
    private readonly TokenManager tokens;
    private readonly Outbox outbox;

    public SessionDataGuard(TokenManager tokens, Outbox outbox, MapCache cache)
    {
        this.tokens = tokens;
        this.outbox = outbox;
        tokens.OnSigningOut(async () =>
        {
            await outbox.ClearAsync().ConfigureAwait(false);
            await cache.ClearAsync().ConfigureAwait(false);
        });
        tokens.SignedIn += OnSignedIn;
    }

    /// <summary>The last sign-in cleanup, for tests and for callers that must wait before reading.</summary>
    public Task Pending { get; private set; } = Task.CompletedTask;

    private void OnSignedIn(object? sender, EventArgs e)
    {
        if (tokens.UserId is { } owner)
        {
            Pending = outbox.DeleteOtherOwnersAsync(owner);
        }
    }

    public void Dispose() => tokens.SignedIn -= OnSignedIn;
}
