using Patika.Api.Security.RateLimiting;
using Patika.Api.Validation;
using Patika.Contracts.Auth;

namespace Patika.Api.Features.Auth;

public static class TotpEndpoints
{
    public static IEndpointRouteBuilder MapTotp(this IEndpointRouteBuilder endpoints)
    {
        var me = endpoints.MapGroup("/me/totp").RequireAuthorization().RequireRateLimiting(RateLimitPolicies.Totp);
        me.MapPost("/enrol", (HttpContext http, TotpService service, CancellationToken ct) => service.EnrolAsync(http.User, ct));
        me.MapPost("/confirm", (HttpContext http, TotpCodeRequest request, TotpService service, CancellationToken ct) => service.ConfirmAsync(http.User, request.Code, ct)).Validate<TotpCodeRequest>();
        me.MapPost("/disable", (HttpContext http, TotpCodeRequest request, TotpService service, CancellationToken ct) => service.DisableAsync(http.User, request.Code, ct)).Validate<TotpCodeRequest>();
        endpoints.MapPost("/auth/mfa", (MfaRequest request, TotpService service, CancellationToken ct) => service.CompleteMfaAsync(request, ct))
            .RequireRateLimiting(RateLimitPolicies.Totp).Validate<MfaRequest>();
        return endpoints;
    }
}
