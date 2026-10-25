using System.Reflection;

namespace Patika.Api.OpenApi;

public static class OpenApiEndpoints
{
    // Resolve the optional framework package at startup so this feature can be integrated independently.
    public static IServiceCollection AddPatikaOpenApi(this IServiceCollection services)
    {
        Invoke("Microsoft.Extensions.DependencyInjection.OpenApiServiceCollectionExtensions", "AddOpenApi", services, "v1");
        return services;
    }

    public static IEndpointRouteBuilder MapPatikaOpenApi(this IEndpointRouteBuilder endpoints)
    {
        Invoke("Microsoft.AspNetCore.Builder.OpenApiEndpointRouteBuilderExtensions", "MapOpenApi", endpoints, "/openapi.json");
        return endpoints;
    }

    private static void Invoke(string type, string method, object target, string value)
    {
        var assembly = Assembly.Load("Microsoft.AspNetCore.OpenApi");
        var extension = assembly.GetType(type, throwOnError: true)!.GetMethods(BindingFlags.Public | BindingFlags.Static)
            .Single(m => m.Name == method && m.GetParameters().Length == 2 && m.GetParameters()[1].ParameterType == typeof(string));
        extension.Invoke(null, [target, value]);
    }
}
