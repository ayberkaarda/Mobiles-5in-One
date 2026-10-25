using Microsoft.Extensions.DependencyInjection;
using Patika.App.Core.Navigation;
using Patika.App.Pages.Account;
using Patika.App.Pages.Adoption;
using Patika.App.Pages.Animals;
using Patika.App.Pages.Map;
using Patika.App.Pages.Stations;
using Patika.App.Pages.Urgent;

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
        [Routes.Fed] = typeof(FeedingDonePage),
        [Routes.Cooldown] = typeof(FeedingCooldownPage),
        [Routes.AddStation] = typeof(NewStationPage),
        [Routes.Animal] = typeof(AnimalPage),
        [Routes.AdoptionPost] = typeof(AdoptionPostPage),
        [Routes.AdoptionRequest] = typeof(AdoptionRequestPage),
        [Routes.UrgentNew] = typeof(UrgentCreatePage),
        [Routes.UrgentSettings] = typeof(UrgentAlertSettingsPage),
        [Routes.Settings] = typeof(AccountSettingsPage),
        [Routes.DeleteAccount] = typeof(AccountDeletionPage),
    };

    public AppShell()
    {
        InitializeComponent();
        AssertRoutesResolve();
        foreach (var (route, page) in PushedRoutes)
        {
            Routing.RegisterRoute(route, page);
        }
    }

    /// <summary>
    /// Every page the Shell can create must be in the service container, or navigation fails only when
    /// someone taps. Checked at startup so a missing registration stops the app at once.
    /// </summary>
    private static void AssertRoutesResolve()
    {
        var services = IPlatformApplication.Current?.Services;
        if (services?.GetService<IServiceProviderIsService>() is not { } probe)
        {
            return;
        }

        var pages = PushedRoutes.Values.Concat([typeof(MapPage), typeof(AdoptPage), typeof(UrgentPage), typeof(ProfilePage), typeof(SignInPage)]);
        var missing = pages.Distinct().Where(page => !probe.IsService(page)).Select(page => page.Name).ToList();
        if (missing.Count > 0)
        {
            throw new InvalidOperationException("Shell pages missing from the service container: " + string.Join(", ", missing));
        }
    }

    protected override void OnNavigated(ShellNavigatedEventArgs args)
    {
        base.OnNavigated(args);

        // The urgent screen sits on the dark Kaldırım surface; every other screen is on Kar.
        StatusBar.UseDarkIcons(CurrentPage is not Pages.Urgent.UrgentPage);
    }
}
