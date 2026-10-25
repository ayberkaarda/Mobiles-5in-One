using Patika.App.Core.Navigation;
using Patika.App.Pages.Account;
using Patika.App.Pages.Common;
using Patika.App.Pages.Stations;

namespace Patika.App;

public partial class AppShell : Shell
{
    /// <summary>Pushed screens of the canvas, by route. Feature packages swap the page type for their own.</summary>
    internal static readonly IReadOnlyDictionary<string, Type> PushedRoutes = new Dictionary<string, Type>
    {
        [Routes.SignUp] = typeof(SignUpPage),
        [Routes.Verify] = typeof(VerifyPage),
        [Routes.Station] = typeof(StationPage),
        [Routes.Outbox] = typeof(OutboxPage),
        [Routes.Fed] = typeof(FedPage),
        [Routes.Cooldown] = typeof(CooldownPage),
        [Routes.AddStation] = typeof(AddStationPage),
        [Routes.Animal] = typeof(AnimalPage),
        [Routes.AdoptionPost] = typeof(AdoptionPostPage),
        [Routes.AdoptionRequest] = typeof(AdoptionRequestPage),
        [Routes.UrgentNew] = typeof(UrgentNewPage),
        [Routes.UrgentSettings] = typeof(UrgentSettingsPage),
        [Routes.Settings] = typeof(SettingsPage),
        [Routes.DeleteAccount] = typeof(DeleteAccountPage),
    };

    public AppShell()
    {
        InitializeComponent();
        foreach (var (route, page) in PushedRoutes)
        {
            Routing.RegisterRoute(route, page);
        }
    }

    protected override void OnNavigated(ShellNavigatedEventArgs args)
    {
        base.OnNavigated(args);

        // The urgent screen sits on the dark Kaldırım surface; every other screen is on Kar.
        StatusBar.UseDarkIcons(CurrentPage is not Pages.Urgent.UrgentPage);
    }
}
