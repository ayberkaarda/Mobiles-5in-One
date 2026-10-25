using Patika.App.Services;

namespace Patika.App;

public partial class App : Application
{
    private readonly SessionCoordinator session;

    public App(SessionCoordinator session)
    {
        InitializeComponent();
        UserAppTheme = AppTheme.Light;
        this.session = session;
    }

    protected override Window CreateWindow(IActivationState? activationState)
    {
        var shell = new AppShell();
        shell.Loaded += async (_, _) => await session.StartAsync();
        return new Window(shell);
    }
}
