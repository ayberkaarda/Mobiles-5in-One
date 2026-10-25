using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Patika.Api.Security.Tokens;
using Patika.Domain.Security;

namespace Patika.Api.Security.Authorization;

/// <summary>Requires a permission from the static matrix in <see cref="Permissions"/>.</summary>
public sealed class PermissionRequirement(Permission permission) : IAuthorizationRequirement
{
    public Permission Permission { get; } = permission;

    public override string ToString() => $"Permission:{Permission}";
}

/// <summary>The caller owns the resource, or is a moderator or administrator.</summary>
public sealed class OwnerOrModeratorRequirement : IAuthorizationRequirement
{
    public static OwnerOrModeratorRequirement Instance { get; } = new();
}

public static class ActorFactory
{
    public static Actor FromPrincipal(ClaimsPrincipal? principal)
    {
        if (principal?.Identity?.IsAuthenticated != true)
        {
            return Actor.Guest;
        }

        var subject = principal.FindFirstValue(PatikaClaims.Subject);
        var role = principal.FindFirstValue(PatikaClaims.Role);
        if (!Guid.TryParse(subject, out var userId)
            || !Enum.TryParse<ActorRole>(role, ignoreCase: false, out var actorRole)
            || actorRole == ActorRole.Guest
            || !Enum.IsDefined(actorRole))
        {
            return Actor.Guest;
        }

        return new Actor(userId, actorRole);
    }
}

/// <summary>
/// Endpoint gate when the resource is not yet known (<see cref="Permissions.CanAttempt"/>) and the
/// resource-based decision when it is (<see cref="Permissions.IsAllowed"/>).
/// </summary>
public sealed class PermissionAuthorizationHandler : AuthorizationHandler<PermissionRequirement>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, PermissionRequirement requirement)
    {
        var actor = ActorFactory.FromPrincipal(context.User);
        var allowed = context.Resource is IProtectedResource resource
            ? Permissions.IsAllowed(actor, requirement.Permission, resource)
            : Permissions.CanAttempt(actor, requirement.Permission);
        if (allowed)
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}

public sealed class OwnerOrModeratorHandler : AuthorizationHandler<OwnerOrModeratorRequirement, IProtectedResource>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context, OwnerOrModeratorRequirement requirement, IProtectedResource resource)
    {
        if (Permissions.IsOwnerOrModerator(ActorFactory.FromPrincipal(context.User), resource))
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}

public static class AuthorizationExtensions
{
    public static TBuilder RequirePermission<TBuilder>(this TBuilder builder, Permission permission)
        where TBuilder : IEndpointConventionBuilder =>
        builder.RequireAuthorization(policy => policy.AddRequirements(new PermissionRequirement(permission)));

    /// <summary>Resource-based check for a loaded resource.</summary>
    public static async Task<bool> IsAllowedAsync(
        this IAuthorizationService authorization, ClaimsPrincipal user, IProtectedResource resource, Permission permission) =>
        (await authorization.AuthorizeAsync(user, resource, new PermissionRequirement(permission))).Succeeded;
}
