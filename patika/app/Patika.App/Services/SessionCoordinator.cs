using Patika.App.Core.Api;
using Patika.App.Core.Navigation;
using Patika.App.Core.Offline;

namespace Patika.App.Services;

/// <summary>
/// App-wide session wiring: picks the first screen, starts the outbox replayer, and sends the user to
/// sign-in when the session ends (refresh rejected or a 401 after refresh).
/// </summary>
public sealed class SessionCoordinator
{
    private readonly TokenManager tokens;
    private readonly OutboxReplayer replayer;
    private readonly INavigationService navigation;
    private bool started;

    public SessionCoordinator(TokenManager tokens, OutboxReplayer replayer, INavigationService navigation,
        SessionDataGuard guard)
    {
        this.tokens = tokens;
        this.replayer = replayer;
        this.navigation = navigation;
        _ = guard;
        tokens.SessionExpired += OnSessionExpired;
        tokens.SignedOut += OnSignedOut;
    }

    /// <summary>Set when the session ended on its own, so sign-in can say why.</summary>
    public string? LastNotice { get; set; }

    public async Task StartAsync()
    {
        if (started)
        {
            return;
        }

        started = true;
        var hasSession = await tokens.RestoreAsync();
        replayer.Start();
        if (!hasSession)
        {
            await navigation.GoToAsync(Routes.SignIn);
        }
    }

    private void OnSessionExpired(object? sender, EventArgs e)
    {
        LastNotice = ErrorMessages.SignInRequired;
        _ = navigation.GoToAsync(Routes.SignIn);
    }

    private void OnSignedOut(object? sender, EventArgs e) => _ = navigation.GoToAsync(Routes.SignIn);
}
