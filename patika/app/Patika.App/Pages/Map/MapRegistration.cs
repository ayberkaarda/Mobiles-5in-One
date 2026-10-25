using Microsoft.Extensions.DependencyInjection;
using Patika.App.Core.Api;
using Patika.App.Core.Map;
using Patika.App.Core.Media;
using Patika.App.Core.Navigation;
using Patika.App.Core.Offline;
using Patika.App.Media;
using Patika.App.Pages.Stations;
using Patika.App.ViewModels.Map;
using Patika.App.ViewModels.Stations;

namespace Patika.App.Pages.Map;

/// <summary>Package B: the map, stations, Beslendi and Bekleme, add station, the outbox, and the photo pipeline.</summary>
public static class MapRegistration
{
    /// <summary>
    /// Registers the map and station screens and the shared photo uploader. Call after the core services
    /// (it wraps their <see cref="IOutboxSender"/>) and before the Shell is created (it sets the routes).
    /// </summary>
    public static IServiceCollection AddMapAndStationScreens(this IServiceCollection services)
    {
        // Cooldown: every feeding the server takes or refuses lands in the book, from the tap or the queue.
        services.AddSingleton(provider => new CooldownBook(provider.GetRequiredService<TokenManager>(),
            provider.GetRequiredService<TimeProvider>(), provider.GetRequiredService<PatikaApiClient>().ServerTime));
        services.AddSingleton<IOutboxSender>(provider => new CooldownAwareSender(
            new ApiOutboxSender(provider.GetRequiredService<PatikaApiClient>()), provider.GetRequiredService<CooldownBook>()));

        // Photos: platform decode, then the Core strip and checks, then presign + PUT on a token-free client.
        services.AddSingleton<IImageTranscoder, AndroidImageTranscoder>();
        services.AddSingleton<IPhotoPicker, MauiPhotoPicker>();
        services.AddSingleton(provider => new PhotoPipeline(provider.GetRequiredService<IImageTranscoder>()));
        services.AddSingleton<IPhotoUploader>(provider => new PhotoUploader(provider.GetRequiredService<PatikaApiClient>(),
            provider.GetRequiredService<PhotoPipeline>(), StorageOrigins.CreateClient(TimeSpan.FromMinutes(2)), LoadStorageOrigins()));

        services.AddTransient<FeedPlanner>();
        services.AddTransient<FeedFlow>();
        services.AddSingleton<MapViewModel>().AddTransient<MapPage>();
        services.AddTransient<StationViewModel>().AddTransient<StationPage>();
        services.AddTransient<FeedingDoneViewModel>().AddTransient<FeedingDonePage>();
        services.AddTransient<FeedingCooldownViewModel>().AddTransient<FeedingCooldownPage>();
        services.AddTransient<NewStationViewModel>().AddTransient<NewStationPage>();
        services.AddTransient<OutboxViewModel>().AddTransient<OutboxPage>();

        // Shell reads this table when it is created; replace the placeholders of this package before then.
        if (AppShell.PushedRoutes is IDictionary<string, Type> routes)
        {
            foreach (var (route, page) in Pages)
            {
                routes[route] = page;
            }
        }

        return services;
    }

    /// <summary>
    /// <c>Storage:Origins</c> from the embedded settings (the Development file overrides in Debug). Cleartext is
    /// accepted only in Debug and only for the emulator host alias and loopback.
    /// </summary>
    private static StorageOrigins LoadStorageOrigins()
    {
        var origins = ReadOrigins("appsettings.json");
#if DEBUG
        origins = ReadOrigins("appsettings.Development.json") ?? origins;
        return new StorageOrigins(origins ?? [], StorageOrigins.DevelopmentCleartextHosts);
#else
        return new StorageOrigins(origins ?? []);
#endif
    }

    private static string[]? ReadOrigins(string name)
    {
        var assembly = typeof(MapRegistration).Assembly;
        var resource = assembly.GetManifestResourceNames().FirstOrDefault(n => n.EndsWith("." + name, StringComparison.Ordinal));
        if (resource is null)
        {
            return null;
        }

        using var stream = assembly.GetManifestResourceStream(resource)!;
        using var document = System.Text.Json.JsonDocument.Parse(stream);
        return document.RootElement.TryGetProperty("Storage", out var storage) && storage.TryGetProperty("Origins", out var list)
            && list.ValueKind == System.Text.Json.JsonValueKind.Array
            ? [.. list.EnumerateArray().Select(x => x.GetString()).OfType<string>()]
            : null;
    }

    /// <summary>The pushed routes this package owns and their pages.</summary>
    public static IReadOnlyDictionary<string, Type> Pages { get; } = new Dictionary<string, Type>
    {
        [Routes.Station] = typeof(StationPage),
        [Routes.Fed] = typeof(FeedingDonePage),
        [Routes.Cooldown] = typeof(FeedingCooldownPage),
        [Routes.AddStation] = typeof(NewStationPage),
        [Routes.Outbox] = typeof(OutboxPage),
    };
}
