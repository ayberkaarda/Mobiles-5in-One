using Microsoft.Extensions.DependencyInjection;
using Patika.App.Core.Navigation;
using Patika.App.Pages.Adoption;
using Patika.App.ViewModels.Adoption;
using Patika.App.ViewModels.Animals;

namespace Patika.App.Pages.Animals;

public static class AnimalsRegistration
{
    public const string MyAdoptionRequestsRoute = "taleplerim";
    public static IServiceCollection AddAnimalAndAdoptionPages(this IServiceCollection services)
    {
        services.AddTransient<AnimalViewModel>();
        services.AddTransient<AdoptViewModel>();
        services.AddTransient<AdoptionPostViewModel>();
        services.AddTransient<AdoptionRequestViewModel>();
        services.AddTransient<MyAdoptionRequestsViewModel>();
        services.AddTransient<AnimalPage>();
        services.AddTransient<AdoptPage>();
        services.AddTransient<AdoptionPostPage>();
        services.AddTransient<AdoptionRequestPage>();
        services.AddTransient<MyAdoptionRequestsPage>();
        // Shell reads this table when it starts; replace the feature entries before then.
        if (AppShell.PushedRoutes is IDictionary<string, Type> routes)
        {
            routes[Routes.Animal] = typeof(AnimalPage);
            routes[Routes.AdoptionPost] = typeof(AdoptionPostPage);
            routes[Routes.AdoptionRequest] = typeof(AdoptionRequestPage);
            routes[MyAdoptionRequestsRoute] = typeof(MyAdoptionRequestsPage);
        }
        return services;
    }
}
