namespace Patika.Domain.Security;

/// <summary>
/// Roles as seen by the authorization layer. <see cref="Guest"/> is an anonymous caller;
/// the remaining values mirror the persisted user roles.
/// </summary>
public enum ActorRole
{
    Guest,
    User,
    Trusted,
    Moderator,
    Admin,
}

/// <summary>The caller an authorization decision is made for.</summary>
public sealed record Actor(Guid? UserId, ActorRole Role)
{
    public static Actor Guest { get; } = new(null, ActorRole.Guest);

    public bool IsAuthenticated => UserId is not null && Role != ActorRole.Guest;

    public bool IsModeratorOrAbove => Role is ActorRole.Moderator or ActorRole.Admin;
}
