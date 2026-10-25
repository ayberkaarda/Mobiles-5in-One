namespace Patika.Domain.Security;

/// <summary>Actions guarded by the authorization matrix (docs/security/authorization-matrix.md).</summary>
public enum Permission
{
    AuthSession,
    MeManage,
    StationsRead,
    StationsCreate,
    StationsUpdate,
    FeedingsCreate,
    AnimalsRead,
    AnimalsCreate,
    AnimalsUpdate,
    AnimalFollow,
    AdoptionsRead,
    AdoptionPostCreate,
    AdoptionPostUpdate,
    AdoptionRequestCreate,
    AdoptionRequestsRead,
    AdoptionRequestUpdate,
    UrgentRead,
    UrgentCreate,
    UrgentUpdate,
    CarePlacesRead,
    UploadsPresign,
    ReportsCreate,
    SubscriptionsVerify,
    WebhookAppStore,
    AdminArea,
    ModerationQueue,
    CarePlacesVerify,
    RolesManage,
    CarePlacesImport,
    UserAdminActions,
    UserEmailsRead,
}

/// <summary>What a role may do for a permission.</summary>
public enum Grant
{
    /// <summary>Not permitted.</summary>
    Deny,

    /// <summary>Only published/public records.</summary>
    Public,

    /// <summary>Generally permitted; resource validation still applies.</summary>
    Allow,

    /// <summary>Only resources the caller owns or is a party to.</summary>
    Own,

    /// <summary>Any resource (moderation, administration or the trusted-station policy).</summary>
    Any,

    /// <summary>Not an interactive role decision: a verified service signature is required.</summary>
    Signature,
}

/// <summary>
/// The static role matrix. Endpoint gates call <see cref="CanAttempt"/>; resource-based handlers call
/// <see cref="IsAllowed"/> once the target resource is loaded.
/// </summary>
public static class Permissions
{
    private const Grant D = Grant.Deny;
    private const Grant P = Grant.Public;
    private const Grant A = Grant.Allow;
    private const Grant O = Grant.Own;
    private const Grant X = Grant.Any;
    private const Grant S = Grant.Signature;

    // Columns: Guest, User, Trusted, Moderator, Admin.
    private static readonly Dictionary<Permission, Grant[]> Table = new()
    {
        [Permission.AuthSession] = [A, A, A, A, A],
        [Permission.MeManage] = [D, O, O, O, O],
        [Permission.StationsRead] = [P, P, P, P, P],
        [Permission.StationsCreate] = [D, A, A, A, A],
        [Permission.StationsUpdate] = [D, O, X, X, X],
        [Permission.FeedingsCreate] = [D, A, A, A, A],
        [Permission.AnimalsRead] = [P, P, P, P, P],
        [Permission.AnimalsCreate] = [D, A, A, A, A],
        [Permission.AnimalsUpdate] = [D, O, O, X, X],
        [Permission.AnimalFollow] = [D, O, O, O, O],
        [Permission.AdoptionsRead] = [P, P, P, P, P],
        [Permission.AdoptionPostCreate] = [D, O, O, X, X],
        [Permission.AdoptionPostUpdate] = [D, O, O, X, X],
        [Permission.AdoptionRequestCreate] = [D, A, A, A, A],
        [Permission.AdoptionRequestsRead] = [D, O, O, X, X],
        [Permission.AdoptionRequestUpdate] = [D, O, O, X, X],
        [Permission.UrgentRead] = [P, P, P, P, P],
        [Permission.UrgentCreate] = [D, A, A, A, A],
        [Permission.UrgentUpdate] = [D, O, O, X, X],
        [Permission.CarePlacesRead] = [P, P, P, P, P],
        [Permission.UploadsPresign] = [D, A, A, A, A],
        [Permission.ReportsCreate] = [D, A, A, A, A],
        [Permission.SubscriptionsVerify] = [D, O, O, D, X],
        [Permission.WebhookAppStore] = [S, S, S, S, S],
        [Permission.AdminArea] = [D, D, D, X, X],
        [Permission.ModerationQueue] = [D, D, D, X, X],
        [Permission.CarePlacesVerify] = [D, D, D, X, X],
        [Permission.RolesManage] = [D, D, D, D, X],
        [Permission.CarePlacesImport] = [D, D, D, D, X],
        [Permission.UserAdminActions] = [D, D, D, D, X],
        [Permission.UserEmailsRead] = [D, D, D, D, X],
    };

    public static IReadOnlyCollection<Permission> All { get; } = Enum.GetValues<Permission>();

    public static Grant GrantFor(ActorRole role, Permission permission)
    {
        if (!Table.TryGetValue(permission, out var row))
        {
            return Grant.Deny;
        }

        var index = (int)role;
        return index >= 0 && index < row.Length ? row[index] : Grant.Deny;
    }

    /// <summary>
    /// Endpoint-level gate, evaluated before the resource is known. <see cref="Grant.Own"/> lets an
    /// authenticated caller through so that the resource handler can decide; it never decides alone.
    /// </summary>
    public static bool CanAttempt(Actor actor, Permission permission) =>
        GrantFor(actor.Role, permission) switch
        {
            Grant.Public or Grant.Allow => true,
            Grant.Own or Grant.Any => actor.IsAuthenticated,
            _ => false,
        };

    /// <summary>Resource-level decision for a loaded resource.</summary>
    public static bool IsAllowed(Actor actor, Permission permission, IProtectedResource resource)
    {
        ArgumentNullException.ThrowIfNull(resource);
        return GrantFor(actor.Role, permission) switch
        {
            Grant.Public => resource.IsPublic,
            Grant.Allow => actor.Role == ActorRole.Guest || actor.IsAuthenticated,
            Grant.Own => actor.UserId is { } id && actor.IsAuthenticated && resource.IsOwnedBy(id),
            Grant.Any => actor.IsAuthenticated,
            _ => false,
        };
    }

    /// <summary>The rule behind <c>OwnerOrModeratorRequirement</c>.</summary>
    public static bool IsOwnerOrModerator(Actor actor, IProtectedResource resource)
    {
        ArgumentNullException.ThrowIfNull(resource);
        if (!actor.IsAuthenticated || actor.UserId is not { } id)
        {
            return false;
        }

        return actor.IsModeratorOrAbove || resource.IsOwnedBy(id);
    }
}
