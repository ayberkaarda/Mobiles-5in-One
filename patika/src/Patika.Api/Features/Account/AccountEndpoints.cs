using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Patika.Api.Email;
using Patika.Api.Features.Auth;
using Patika.Api.Security.Authorization;
using Patika.Api.Security.RateLimiting;
using Patika.Api.Security.Tokens;
using Patika.Contracts.Account;
using Patika.Contracts.Auth;
using Patika.Contracts.Errors;
using Patika.Domain.Security;

namespace Patika.Api.Features.Account;

public static class AccountEndpoints
{
    /// <summary>Signing in again before this period ends cancels the deletion.</summary>
    public static readonly TimeSpan DeletionGracePeriod = TimeSpan.FromDays(7);

    private const string ProblemJson = "application/problem+json";

    public static IServiceCollection AddPatikaAccount(this IServiceCollection services)
    {
        services.AddScoped<IAccountDeletionStore, EfAccountDeletionStore>();
        return services;
    }

    /// <summary>Maps <c>DELETE /me</c> on the given (<c>/v1</c>) group.</summary>
    public static IEndpointRouteBuilder MapAccount(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGroup("/me").WithTags("Me")
            .MapDelete("", DeleteMeAsync)
            .RequirePermission(Permission.MeManage)
            .RequireRateLimiting(RateLimitPolicies.External)
            .Produces<AccountDeletionResponse>(StatusCodes.Status202Accepted)
            .Produces<ApiProblemDetails>(StatusCodes.Status401Unauthorized, ProblemJson)
            .Produces<ApiProblemDetails>(StatusCodes.Status403Forbidden, ProblemJson);
        return endpoints;
    }

    /// <summary>
    /// Requires a sign-in (password or Google) from the last ten minutes. Deactivates the account at
    /// once and schedules the hard delete after <see cref="DeletionGracePeriod"/>; a confirmation
    /// email goes to the address on file.
    /// </summary>
    internal static async Task<IResult> DeleteMeAsync(
        HttpContext http, IAuthStore authStore, [FromServices] IAccountDeletionStore deletionStore, IAuthorizationService authorization,
        IEmailSender emailSender, TimeProvider clock, ILoggerFactory loggers, CancellationToken ct)
    {
        var logger = loggers.CreateLogger(typeof(AccountEndpoints));
        var actor = ActorFactory.FromPrincipal(http.User);
        var user = actor.UserId is { } id ? await authStore.FindUserByIdAsync(id, ct) : null;
        if (user is null || !user.IsActive
            || !await authorization.IsAllowedAsync(http.User, new OwnedResource(user.Id), Permission.MeManage))
        {
            return TypedResults.Unauthorized();
        }

        var now = clock.GetUtcNow();
        if (!AuthHandlers.IsRecentAuthentication(http.User, now, PatikaClaims.PasswordMethod, PatikaClaims.ExternalMethod))
        {
            return AuthHandlers.Problem(StatusCodes.Status403Forbidden, AuthErrorCodes.ReauthenticationRequired,
                "Sign in again to delete your account.");
        }

        var schedule = await deletionStore.RequestDeletionAsync(user.Id, now, DeletionGracePeriod, ct);
        if (schedule is null)
        {
            return TypedResults.Unauthorized();
        }

        if (schedule.Created)
        {
            SessionVersionCache.Shared.Invalidate(user.Id);
            logger.LogInformation("User {UserId} requested account deletion; deactivated until the hard delete", user.Id);
            if (user.Email is not null)
            {
                // The account is already deactivated; a client disconnect must not cancel the confirmation.
                await emailSender.SendAsync(AccountEmails.DeletionScheduled(user.Email, schedule.ExecuteAfter),
                    CancellationToken.None);
            }
        }

        return TypedResults.Accepted((string?)null,
            new AccountDeletionResponse(AccountDeletionResponse.Scheduled, schedule.ExecuteAfter));
    }
}
