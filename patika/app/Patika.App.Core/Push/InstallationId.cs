namespace Patika.App.Core.Push;

/// <summary>Durable slot for the installation id. The app backs it with SecureStorage.</summary>
public interface IInstallationIdStore
{
    Task<string?> ReadAsync();

    Task WriteAsync(string value);

    Task ClearAsync();
}

/// <summary>
/// A random UUID made once per install and kept across restarts and sign-ins. The API lets a push token move
/// between accounts only when the same installation presents it, so the id must stay stable; it identifies
/// the install, never the person, and is not derived from any device identifier.
/// </summary>
public sealed class InstallationId(IInstallationIdStore store)
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private Guid? cached;

    public async Task<Guid> GetAsync()
    {
        if (cached is { } known)
        {
            return known;
        }

        await gate.WaitAsync().ConfigureAwait(false);
        try
        {
            if (cached is { } again)
            {
                return again;
            }

            var stored = await store.ReadAsync().ConfigureAwait(false);
            if (Guid.TryParseExact(stored, "D", out var parsed) && parsed != Guid.Empty)
            {
                cached = parsed;
                return parsed;
            }

            // First start, or the slot was lost (keystore reset after a restore): a new install from here on.
            var created = Guid.NewGuid();
            await store.WriteAsync(created.ToString("D")).ConfigureAwait(false);
            cached = created;
            return created;
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>Forgets the id in memory and in storage (account deletion); the next read makes a new one.</summary>
    public async Task ResetAsync()
    {
        await gate.WaitAsync().ConfigureAwait(false);
        try
        {
            cached = null;
            await store.ClearAsync().ConfigureAwait(false);
        }
        finally
        {
            gate.Release();
        }
    }
}
