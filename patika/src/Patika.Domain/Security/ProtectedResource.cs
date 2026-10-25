namespace Patika.Domain.Security;

/// <summary>
/// A resource an authorization decision is made against. Ownership can involve more than one
/// user (for example an adoption request is owned by the requester and by the post owner).
/// </summary>
public interface IProtectedResource
{
    /// <summary>True when the resource is published and visible to the public.</summary>
    bool IsPublic { get; }

    bool IsOwnedBy(Guid userId);
}

/// <summary>A simple resource with an explicit owner set, used by handlers and tests.</summary>
public sealed class OwnedResource : IProtectedResource
{
    private readonly HashSet<Guid> owners;

    public OwnedResource(IEnumerable<Guid> owners, bool isPublic = false)
    {
        this.owners = [.. owners];
        IsPublic = isPublic;
    }

    public OwnedResource(Guid owner, bool isPublic = false)
        : this([owner], isPublic)
    {
    }

    public bool IsPublic { get; }

    public bool IsOwnedBy(Guid userId) => owners.Contains(userId);
}
