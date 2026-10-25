using Patika.App.Core.Api;
using Patika.App.Core.Location;
using Patika.App.Core.Navigation;
using Patika.App.Core.Offline;
using Patika.App.Pages.Account;
using Patika.App.Pages.Adoption;
using Patika.App.Pages.Map;
using Patika.App.Pages.Stations;
using Patika.App.Pages.Urgent;
using Patika.App.Services;
using Patika.App.Services.Api;
using Patika.App.Services.Location;
using Patika.App.Services.Navigation;
using Patika.App.Services.Offline;
using Patika.App.ViewModels.Account;
using Patika.App.ViewModels.Map;
using Patika.App.ViewModels.Stations;

namespace Patika.App;

public static class MauiProgram
{
    public static MauiApp CreateMauiApp()
    {
        var builder = MauiApp.CreateBuilder();
        builder
            .UseMauiApp<App>()
            .ConfigureFonts(fonts =>
            {
                // Display: Nunito. Body: Nunito Sans. Both SIL OFL 1.1, see Resources/Fonts/licenses.
                fonts.AddFont("Nunito-Bold.ttf", "NunitoBold");
                fonts.AddFont("Nunito-ExtraBold.ttf", "NunitoExtraBold");
                fonts.AddFont("NunitoSans-Regular.ttf", "NunitoSans");
                fonts.AddFont("NunitoSans-SemiBold.ttf", "NunitoSansSemiBold");
                fonts.AddFont("NunitoSans-Bold.ttf", "NunitoSansBold");
            });

        AddCore(builder.Services);
        AddScreens(builder.Services);
        return builder.Build();
    }

    /// <summary>Core services: one instance each for the app's lifetime.</summary>
    private static void AddCore(IServiceCollection services)
    {
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton(AppSettings.LoadApiOptions());
        services.AddSingleton<ITokenStore, SecureStorageTokenStore>();
        services.AddSingleton<TokenManager>();
        services.AddSingleton(provider => new PatikaApiClient(new HttpClient(), provider.GetRequiredService<TokenManager>(),
            provider.GetRequiredService<ApiOptions>()));

        services.AddSingleton(_ => new OfflineDatabase(Path.Combine(FileSystem.AppDataDirectory, "patika-offline.db")));
        services.AddSingleton<INetworkStatus, MauiNetworkStatus>();
        services.AddSingleton<MapCache>(provider => new MapCache(provider.GetRequiredService<OfflineDatabase>(),
            provider.GetRequiredService<TimeProvider>()));
        services.AddSingleton<Outbox>();
        services.AddSingleton<IOutboxSender, ApiOutboxSender>();
        services.AddSingleton<OutboxReplayer>();
        services.AddSingleton<FieldActions>();
        services.AddSingleton<SessionDataGuard>();

        services.AddSingleton<ILocationService, MauiLocationService>();
        services.AddSingleton<INavigationService, ShellNavigationService>();
        services.AddSingleton<SessionCoordinator>();
    }

    /// <summary>Pages and view models. Feature packages add theirs next to these.</summary>
    private static void AddScreens(IServiceCollection services)
    {
        services.AddTransient<SignInViewModel>().AddTransient<SignInPage>();
        services.AddTransient<SignUpViewModel>().AddTransient<SignUpPage>();
        services.AddTransient<VerifyViewModel>().AddTransient<VerifyPage>();
        services.AddTransient<ProfileViewModel>().AddTransient<ProfilePage>();
        services.AddSingleton<MapViewModel>().AddTransient<MapPage>();
        services.AddTransient<StationViewModel>().AddTransient<StationPage>();
        services.AddTransient<OutboxViewModel>().AddTransient<OutboxPage>();
        services.AddTransient<AdoptPage>();
        services.AddTransient<UrgentPage>();
    }
}
