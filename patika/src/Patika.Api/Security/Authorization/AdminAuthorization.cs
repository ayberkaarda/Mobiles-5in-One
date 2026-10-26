using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Patika.Api.Features.Auth;
using Patika.Api.Security.Tokens;

namespace Patika.Api.Security.Authorization;

public static class AdminPolicies
{
    public const string Moderate = "Admin.Moderate";
    public const string Manage = "Admin.Manage";

    public static IServiceCollection AddAdminAuthorization(this IServiceCollection services)
    {
        services.AddAuthorization(options =>
        {
            options.AddPolicy(Moderate, policy => policy.RequireAuthenticatedUser().RequireRole("Moderator", "Admin")
                .RequireClaim(PatikaClaims.AuthMethod, PatikaClaims.MfaMethod));
            options.AddPolicy(Manage, policy => policy.RequireAuthenticatedUser().RequireRole("Admin")
                .RequireClaim(PatikaClaims.AuthMethod, PatikaClaims.MfaMethod));
        });
        services.AddSingleton<IAuthorizationMiddlewareResultHandler, AdminAuthorizationResultHandler>();
        return services;
    }
}

public sealed class AdminAuthorizationResultHandler : IAuthorizationMiddlewareResultHandler
{
    private readonly AuthorizationMiddlewareResultHandler fallback = new();

    public async Task HandleAsync(RequestDelegate next, HttpContext context, AuthorizationPolicy policy, PolicyAuthorizationResult result)
    {
        if (result.Forbidden && context.GetEndpoint()?.Metadata.GetOrderedMetadata<IAuthorizeData>()
                .Any(x => x.Policy is AdminPolicies.Moderate or AdminPolicies.Manage) == true
            && (context.User.IsInRole("Moderator") || context.User.IsInRole("Admin"))
            && !context.User.HasClaim(PatikaClaims.AuthMethod, PatikaClaims.MfaMethod))
        {
            await TotpService.Error(403, "mfa_required").ExecuteAsync(context);
            return;
        }
        await fallback.HandleAsync(next, context, policy, result);
    }
}
