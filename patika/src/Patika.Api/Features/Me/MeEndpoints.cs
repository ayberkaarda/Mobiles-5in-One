using Microsoft.AspNetCore.Authorization;
using Patika.Api.Features.Account;
using Patika.Api.Features.Auth;
using Patika.Api.Security.Authorization;
using Patika.Api.Security.RateLimiting;
using Patika.Api.Validation;
using Patika.Contracts.Auth;
using Patika.Contracts.Errors;
using Patika.Domain.Security;

namespace Patika.Api.Features.Me;

public static class MeEndpoints
{
    private const string ProblemJson = "application/problem+json";

    public static IEndpointRouteBuilder MapMe(this IEndpointRouteBuilder endpoints)
    {
        var me = endpoints.MapGroup("/me").WithTags("Me").RequirePermission(Permission.MeManage);

        me.MapGet("", GetMeAsync)
            .Produces<MeResponse>()
            .Produces<ApiProblemDetails>(StatusCodes.Status401Unauthorized, ProblemJson);

        me.MapPost("/external-logins/google", LinkGoogleAsync)
            .Validate<LinkExternalLoginRequest>()
            .RequireRateLimiting(RateLimitPolicies.External)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<ApiProblemDetails>(StatusCodes.Status403Forbidden, ProblemJson)
            .Produces<ApiProblemDetails>(StatusCodes.Status409Conflict, ProblemJson);

        return endpoints;
    }

    private static async Task<IResult> GetMeAsync(
        HttpContext http, IAuthStore store, IAccountStatsReader statsReader, IAuthorizationService authorization,
        CancellationToken ct)
    {
        var user = await LoadSelfAsync(http, store, authorization, ct);
        var stats = user is null ? null : await statsReader.ReadAsync(user.Id, ct);
        if (user is null || stats is null)
        {
            return TypedResults.Unauthorized();
        }

        return TypedResults.Ok(new MeResponse(user.Id, user.Email, user.DisplayName, user.Role.ToString(),
            user.EmailVerifiedAt is not null, stats.FeedingCount, stats.Badges(), stats.JoinedAt));
    }

    private static async Task<IResult> LinkGoogleAsync(
        HttpContext http, LinkExternalLoginRequest request, IAuthStore store, IAuthorizationService authorization,
        AuthHandlers handlers, CancellationToken ct)
    {
        if (await LoadSelfAsync(http, store, authorization, ct) is null)
        {
            return TypedResults.Unauthorized();
        }

        return await handlers.LinkExternalAsync(http.User, GoogleIdTokenVerifier.ProviderName, request.IdToken, ct);
    }

    /// <summary>The caller's own account, after the resource-based ownership check.</summary>
    private static async Task<AuthUser?> LoadSelfAsync(
        HttpContext http, IAuthStore store, IAuthorizationService authorization, CancellationToken ct)
    {
        var actor = ActorFactory.FromPrincipal(http.User);
        var user = actor.UserId is { } id ? await store.FindUserByIdAsync(id, ct) : null;
        if (user is null || !user.IsActive)
        {
            return null;
        }

        return await authorization.IsAllowedAsync(http.User, new OwnedResource(user.Id), Permission.MeManage) ? user : null;
    }
}
