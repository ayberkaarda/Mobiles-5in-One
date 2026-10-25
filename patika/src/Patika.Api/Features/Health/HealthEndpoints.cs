using Patika.Contracts.Dto;

namespace Patika.Api.Features.Health;

public static class HealthEndpoints
{
    public static IEndpointRouteBuilder MapHealth(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/health", () => TypedResults.Ok(new HealthResponse("ok")));
        return endpoints;
    }
}
