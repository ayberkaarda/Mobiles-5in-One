using Patika.Contracts.Dto;
using Patika.Infrastructure.Security;

namespace Patika.Api.Features.Health;

public static class HealthEndpoints
{
    public static IEndpointRouteBuilder MapHealth(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/health", () => TypedResults.Ok(new HealthResponse("ok")));

        // Ops self-check for the Web console: echoes only whether the client-address claim was verified.
        endpoints.MapGet("/health/bff", (HttpContext http) =>
            TypedResults.Ok(new BffCheckResponse(TrustedNetwork.BffClaimAccepted(http))));
        return endpoints;
    }
}
