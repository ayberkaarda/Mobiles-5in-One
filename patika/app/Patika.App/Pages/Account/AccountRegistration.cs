using Microsoft.Maui.LifecycleEvents;
using Patika.App.Core.Navigation;
using Patika.App.Core.Push;
using Patika.App.Pages.Urgent;
using Patika.App.Push;
using Patika.App.ViewModels.Account;
using Patika.App.ViewModels.Urgent;

namespace Patika.App.Pages.Account;

/// <summary>
/// Package D: the urgent and account screens, push registration and the notification tap. One call from
/// <c>MauiProgram</c>: <c>builder.AddUrgentAndAccount();</c> after the core services. The urgent photo uses
/// <c>IPhotoPicker</c> and <c>IPhotoUploader</c> from the media package, which registers them.
/// </summary>
public static class AccountRegistration
{
    public static MauiAppBuilder AddUrgentAndAccount(this MauiAppBuilder builder)
    {
        var services = builder.Services;

        // Push: FCM when this build carries google-services.json, otherwise a no-op provider.
        services.AddSingleton<IPushTokenProvider>(_ => (IPushTokenProvider?)FcmPushTokenProvider.TryCreate() ?? new NoPushTokenProvider());
        services.AddSingleton<IInstallationIdStore, SecureInstallationIdStore>();
        services.AddSingleton<InstallationId>();
        services.AddSingleton<IPushStateStore, PreferencesPushStateStore>();
        services.AddSingleton<INotificationPermission, AndroidNotificationPermission>();
        services.AddSingleton<NotificationInbox>();
        services.AddSingleton(provider =>
        {
            var push = ActivatorUtilities.CreateInstance<PushRegistration>(provider);
            push.Attach();
            return push;
        });

        // Account services and platform adapters.
        services.AddSingleton<IGoogleSignIn, NotConfiguredGoogleSignIn>();
        services.AddSingleton<ISessionNotice, CoordinatorSessionNotice>();
        services.AddSingleton<IUserNotice, ShellUserNotice>();
        services.AddSingleton<IAppLauncher, MauiAppLauncher>();
        services.AddSingleton<IDeletionNoticeStore, PreferencesDeletionNoticeStore>();
        services.AddSingleton<IAppAbout, MauiAppAbout>();
        services.AddSingleton<AccountSession>();
        services.AddSingleton<AccountDeletionWipe>();
        services.AddSingleton(_ => new UrgentPreviewFiles(FileSystem.Current.CacheDirectory));
        services.AddSingleton<UrgentApi>();
        services.AddTransient<IUrgentPhotoFlow, UrgentPhotoFlow>();

        // Screens. The tab pages (UrgentPage, ProfilePage) and SignInPage keep the types the Shell names.
        services.AddTransient<SignInViewModel>().AddTransient<SignInPage>();
        services.AddTransient<SignUpViewModel>().AddTransient<SignUpPage>();
        services.AddTransient<VerifyViewModel>().AddTransient<VerifyPage>();
        services.AddTransient<ForgotPasswordViewModel>().AddTransient<ForgotPasswordPage>();
        services.AddTransient<ResetPasswordViewModel>().AddTransient<ResetPasswordPage>();
        services.AddTransient<ProfileViewModel>().AddTransient<ProfilePage>();
        services.AddTransient<AccountSettingsViewModel>().AddTransient<AccountSettingsPage>();
        services.AddTransient<AccountDeletionViewModel>().AddTransient<AccountDeletionPage>();
        services.AddTransient<AboutViewModel>().AddTransient<AboutPage>();
        services.AddTransient<UrgentListViewModel>().AddTransient<UrgentPage>();
        services.AddTransient<UrgentDetailViewModel>().AddTransient<UrgentDetailPage>();
        services.AddTransient<UrgentCreateViewModel>().AddTransient<UrgentCreatePage>();
        services.AddTransient<UrgentSettingsViewModel>().AddTransient<UrgentAlertSettingsPage>();
        services.AddTransient<UrgentAreaPickViewModel>().AddTransient<UrgentAreaPickPage>();

        // Shell reads this table when it starts (after the services are built); swap in the real pages.
        if (AppShell.PushedRoutes is IDictionary<string, Type> routes)
        {
            foreach (var (route, page) in PushedRoutes)
            {
                routes[route] = page;
            }
        }

        builder.ConfigureLifecycleEvents(events => events.AddAndroid(android => android
            .OnCreate((activity, state) =>
            {
                // Resolving it subscribes to sign-in and token rotation for the app's lifetime.
                _ = IPlatformApplication.Current?.Services.GetService<PushRegistration>();
                PushPlatform.OnCreated(activity);
            })
            .OnNewIntent((_, intent) => PushPlatform.OnNewIntent(intent))
            .OnResume(_ => PushPlatform.OnResumed())));

        return builder;
    }

    /// <summary>Pushed routes this package owns: four replace placeholders, the rest are new.</summary>
    public static IReadOnlyDictionary<string, Type> PushedRoutes { get; } = new Dictionary<string, Type>
    {
        [Routes.UrgentNew] = typeof(UrgentCreatePage),
        [Routes.UrgentSettings] = typeof(UrgentAlertSettingsPage),
        [Routes.Settings] = typeof(AccountSettingsPage),
        [Routes.DeleteAccount] = typeof(AccountDeletionPage),
        [UrgentRoutes.Detail] = typeof(UrgentDetailPage),
        [UrgentRoutes.AreaPick] = typeof(UrgentAreaPickPage),
        [AccountRoutes.ForgotPassword] = typeof(ForgotPasswordPage),
        [AccountRoutes.ResetPassword] = typeof(ResetPasswordPage),
        [AccountRoutes.About] = typeof(AboutPage),
    };
}
