namespace Patika.App;

public partial class AppShell : Shell
{
    public AppShell()
    {
        InitializeComponent();
    }

    protected override void OnNavigated(ShellNavigatedEventArgs args)
    {
        base.OnNavigated(args);

        // The urgent screen sits on the dark Kaldırım surface; every other screen is on Kar.
        StatusBar.UseDarkIcons(CurrentPage is not Pages.UrgentPage);
    }
}
