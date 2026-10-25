using Patika.App.Core.Api;
using Patika.Contracts.Urgent;

namespace Patika.App.Core.Push;

/// <summary>
/// What this device last told the API. <see cref="Enabled"/> is the user's switch in Settings; the token and
/// account are kept so sign-out and the switch can remove exactly what was registered.
/// </summary>
public sealed record PushState(bool Enabled, string? Token, string? UserId, DateTimeOffset? SyncedAt)
{
    public static PushState Initial { get; } = new(true, null, null, null);
}

public interface IPushStateStore
{
    Task<PushState> ReadAsync();

    Task WriteAsync(PushState state);
}

public enum PushStatus
{
    /// <summary>This build has no push configuration.</summary>
    NotConfigured,

    /// <summary>The user turned notifications off on this device.</summary>
    Off,

    /// <summary>Nobody is signed in, so there is no account to register for.</summary>
    SignedOut,

    /// <summary>The API holds this device's current token for the signed-in account.</summary>
    Registered,

    /// <summary>No token from the push service, or the API refused it; <see cref="PushRegistration.LastError"/> says why.</summary>
    Failed,
}

/// <summary>
/// Keeps the API's copy of this device's push token in step with the session: registers after every
/// sign-in, when the push service rotates the token and at most twice a day on resume (the API drops
/// devices it has not seen for a while); removes it before sign-out and when the user turns push off.
/// All work is best effort and serialized; a failure never blocks sign-in or sign-out.
/// </summary>
public sealed class PushRegistration
{
    /// <summary>How often a resumed app re-registers so the API keeps the device fresh.</summary>
    public static readonly TimeSpan ResyncInterval = TimeSpan.FromHours(12);

    private readonly PatikaApiClient api;
    private readonly IPushTokenProvider provider;
    private readonly InstallationId installation;
    private readonly IPushStateStore states;
    private readonly INotificationPermission permission;
    private readonly TimeProvider clock;
    private readonly SemaphoreSlim gate = new(1, 1);
    private int attached;
    private volatile bool paused;

    public PushRegistration(PatikaApiClient api, IPushTokenProvider provider, InstallationId installation,
        IPushStateStore states, INotificationPermission permission, TimeProvider clock)
    {
        this.api = api;
        this.provider = provider;
        this.installation = installation;
        this.states = states;
        this.permission = permission;
        this.clock = clock;
    }

    public bool IsConfigured => provider.IsAvailable;

    public PushStatus Status { get; private set; } = PushStatus.SignedOut;

    /// <summary>Turkish text for the last failure, or null.</summary>
    public string? LastError { get; private set; }

    /// <summary>Raised after every attempt, so Settings can refresh its line.</summary>
    public event EventHandler? StatusChanged;

    /// <summary>
    /// Subscribes to sign-in and token rotation once; later calls do nothing. A sign-in ends the pause that
    /// sign-out started and registers for the new session.
    /// </summary>
    public void Attach()
    {
        if (Interlocked.Exchange(ref attached, 1) == 1)
        {
            return;
        }

        api.Tokens.SignedIn += (_, _) =>
        {
            paused = false;
            _ = SyncAsync();
        };
        provider.TokenChanged += (_, _) => _ = SyncAsync();
    }

    /// <summary>True between <see cref="UnregisterAsync"/> and the next sign-in or <see cref="ResumeAsync"/>.</summary>
    public bool IsPaused => paused;

    public async Task<bool> IsEnabledAsync() => (await states.ReadAsync().ConfigureAwait(false)).Enabled;

    /// <summary>Registers this device for the signed-in account when push is configured and switched on.</summary>
    public async Task<PushStatus> SyncAsync(CancellationToken ct = default)
    {
        await gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            return await SyncLockedAsync(ct).ConfigureAwait(false);
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>Ends a pause without a new sign-in (a deletion the API refused) and registers again.</summary>
    public Task<PushStatus> ResumeAsync(CancellationToken ct = default)
    {
        paused = false;
        return SyncAsync(ct);
    }

    /// <summary>The resume path: registers again only when the last success is older than <see cref="ResyncInterval"/>.</summary>
    public async Task<PushStatus> SyncIfDueAsync(CancellationToken ct = default)
    {
        var state = await states.ReadAsync().ConfigureAwait(false);
        if (state.SyncedAt is { } at && clock.GetUtcNow() - at < ResyncInterval
            && string.Equals(state.UserId, api.Tokens.UserId, StringComparison.Ordinal) && state.Token is not null)
        {
            return Status = PushStatus.Registered;
        }

        return await SyncAsync(ct).ConfigureAwait(false);
    }

    /// <summary>
    /// The Settings switch. Turning on asks for the notification permission first; a refusal keeps push off.
    /// Turning off removes the token from the API.
    /// </summary>
    public async Task<PushStatus> SetEnabledAsync(bool enabled, CancellationToken ct = default)
    {
        if (enabled && provider.IsAvailable && !await permission.RequestAsync().ConfigureAwait(false))
        {
            LastError = PushMessages.PermissionDenied;
            Changed(PushStatus.Off);
            return Status;
        }

        await gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var state = await states.ReadAsync().ConfigureAwait(false);
            await states.WriteAsync(state with { Enabled = enabled }).ConfigureAwait(false);
            if (enabled)
            {
                return await SyncLockedAsync(ct).ConfigureAwait(false);
            }

            await UnregisterLockedAsync(ct).ConfigureAwait(false);
            Changed(PushStatus.Off);
            return Status;
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>
    /// Removes the registered token while the session is still valid. Call before signing out. Registrations
    /// pause from here until the next sign-in, so a token rotation during sign-out cannot register again.
    /// </summary>
    public async Task UnregisterAsync(CancellationToken ct = default)
    {
        paused = true;
        await gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            await UnregisterLockedAsync(ct).ConfigureAwait(false);
            Changed(PushStatus.SignedOut);
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>
    /// After account deletion: deletes the platform push token, forgets what was registered and drops the
    /// installation id (memory and storage), so nothing on the device still links it to the closed account.
    /// </summary>
    public async Task ForgetDeviceAsync(CancellationToken ct = default)
    {
        paused = true;
        await gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            if (provider.IsAvailable)
            {
                try
                {
                    await provider.DeleteTokenAsync(ct).ConfigureAwait(false);
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    // No Play services or offline: the token stays unused; the API side is already gone.
                }
            }

            await states.WriteAsync(PushState.Initial).ConfigureAwait(false);
            await installation.ResetAsync().ConfigureAwait(false);
            Changed(PushStatus.SignedOut);
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task<PushStatus> SyncLockedAsync(CancellationToken ct)
    {
        var state = await states.ReadAsync().ConfigureAwait(false);
        if (!provider.IsAvailable)
        {
            return Changed(PushStatus.NotConfigured);
        }

        if (!state.Enabled)
        {
            return Changed(PushStatus.Off);
        }

        if (paused)
        {
            return Changed(PushStatus.SignedOut);
        }

        if (api.Tokens.UserId is null)
        {
            await api.Tokens.RestoreAsync().ConfigureAwait(false);
        }

        // Everything below acts for this account in this session only, the same rule as the outbox.
        if (api.Tokens.Bind() is not { } session)
        {
            return Changed(PushStatus.SignedOut);
        }

        string? token;
        try
        {
            token = await provider.GetTokenAsync(ct).ConfigureAwait(false);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            token = null;
        }

        if (token is null)
        {
            LastError = PushMessages.NoToken;
            return Changed(PushStatus.Failed);
        }

        if (paused)
        {
            return Changed(PushStatus.SignedOut);
        }

        try
        {
            var id = await installation.GetAsync().ConfigureAwait(false);

            // Sent only with a token of the bound session; after an account switch it fails before sending.
            await api.SendAsync<object>(HttpMethod.Put, "me/device-token", new RegisterDeviceRequest(token, id, null),
                AuthMode.Required, ct: ct, session: session).ConfigureAwait(false);
            if (api.Tokens.Generation != session.Generation)
            {
                // The session ended while the request was out: its state must not be written over the new one.
                return Changed(PushStatus.SignedOut);
            }

            await states.WriteAsync(state with { Token = token, UserId = session.UserId, SyncedAt = clock.GetUtcNow() })
                .ConfigureAwait(false);
            LastError = null;
            return Changed(PushStatus.Registered);
        }
        catch (ApiException e)
        {
            LastError = e.Kind == ApiErrorKind.SignInRequired ? null : e.Message;
            return Changed(e.Kind == ApiErrorKind.SignInRequired ? PushStatus.SignedOut : PushStatus.Failed);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            // Best effort: an unreadable answer must not escape a fire-and-forget registration.
            LastError = ErrorMessages.Unknown;
            return Changed(PushStatus.Failed);
        }
    }

    private async Task UnregisterLockedAsync(CancellationToken ct)
    {
        var state = await states.ReadAsync().ConfigureAwait(false);

        // Only the account that registered the token removes it, and only with its own session token.
        if (state.Token is { } token && api.Tokens.Bind() is { } session
            && string.Equals(session.UserId, state.UserId, StringComparison.Ordinal))
        {
            try
            {
                await api.SendAsync<object>(HttpMethod.Delete, "me/device-token", new UnregisterDeviceRequest(token),
                    AuthMode.Required, ct: ct, session: session).ConfigureAwait(false);
            }
            catch (ApiException)
            {
                // Offline or already signed out: the API drops devices it stops seeing, and the next sign-in
                // from this installation moves the token to that account.
            }
        }

        await states.WriteAsync(state with { Token = null, UserId = null, SyncedAt = null }).ConfigureAwait(false);
    }


    private PushStatus Changed(PushStatus status)
    {
        Status = status;
        StatusChanged?.Invoke(this, EventArgs.Empty);
        return status;
    }
}

public static class PushMessages
{
    public const string NotConfigured = "Bu sürümde bildirimler henüz kurulmadı.";
    public const string PermissionDenied = "Bildirim izni verilmedi. Telefonun ayarlarından açabilirsin.";
    public const string NoToken = "Bildirim servisine ulaşılamadı. Biraz sonra yeniden denenecek.";
}
