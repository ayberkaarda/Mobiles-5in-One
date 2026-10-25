using Patika.Domain.Security;
using Xunit;

namespace Patika.SecurityTests;

/// <summary>
/// Every cell of docs/security/authorization-matrix.md, transcribed independently of the production
/// table so that a change to either side fails here.
/// </summary>
public sealed class PermissionsMatrixTests
{
    // Guest, User, Trusted, Moderator, Admin. Legend: - deny, P public, A allow, O own, X any, S signature.
    private static readonly Dictionary<Permission, string> Expected = new()
    {
        [Permission.AuthSession] = "A A A A A",
        [Permission.MeManage] = "- O O O O",
        [Permission.StationsRead] = "P P P P P",
        [Permission.StationsCreate] = "- A A A A",
        [Permission.StationsUpdate] = "- O X X X",
        [Permission.FeedingsCreate] = "- A A A A",
        [Permission.AnimalsRead] = "P P P P P",
        [Permission.AnimalsCreate] = "- A A A A",
        [Permission.AnimalsUpdate] = "- O O X X",
        [Permission.AnimalFollow] = "- O O O O",
        [Permission.AdoptionsRead] = "P P P P P",
        [Permission.AdoptionPostCreate] = "- O O X X",
        [Permission.AdoptionPostUpdate] = "- O O X X",
        [Permission.AdoptionRequestCreate] = "- A A A A",
        [Permission.AdoptionRequestsRead] = "- O O X X",
        [Permission.AdoptionRequestUpdate] = "- O O X X",
        [Permission.UrgentRead] = "P P P P P",
        [Permission.UrgentCreate] = "- A A A A",
        [Permission.UrgentUpdate] = "- O O X X",
        [Permission.CarePlacesRead] = "P P P P P",
        [Permission.UploadsPresign] = "- A A A A",
        [Permission.ReportsCreate] = "- A A A A",
        [Permission.SubscriptionsVerify] = "- O O - X",
        [Permission.WebhookAppStore] = "S S S S S",
        [Permission.AdminArea] = "- - - X X",
        [Permission.ModerationQueue] = "- - - X X",
        [Permission.CarePlacesVerify] = "- - - X X",
        [Permission.RolesManage] = "- - - - X",
        [Permission.CarePlacesImport] = "- - - - X",
        [Permission.UserAdminActions] = "- - - - X",
        [Permission.UserEmailsRead] = "- - - - X",
    };

    private static readonly Guid Self = Guid.Parse("01900000-0000-7000-8000-00000000000a");
    private static readonly Guid Other = Guid.Parse("01900000-0000-7000-8000-00000000000b");

    public static TheoryData<Permission, ActorRole> Cells()
    {
        var data = new TheoryData<Permission, ActorRole>();
        foreach (var permission in Enum.GetValues<Permission>())
        {
            foreach (var role in Enum.GetValues<ActorRole>())
            {
                data.Add(permission, role);
            }
        }

        return data;
    }

    [Fact]
    public void ExpectedTableCoversEveryPermissionAndRole()
    {
        Assert.Equal(Enum.GetValues<Permission>().Order(), Expected.Keys.Order());
        Assert.All(Expected.Values, row => Assert.Equal(Enum.GetValues<ActorRole>().Length, row.Split(' ').Length));
    }

    [Theory]
    [MemberData(nameof(Cells))]
    public void GrantMatchesTheDocumentedMatrix(Permission permission, ActorRole role)
    {
        Assert.Equal(ExpectedGrant(permission, role), Permissions.GrantFor(role, permission));
    }

    [Theory]
    [MemberData(nameof(Cells))]
    public void DecisionsFollowTheGrantForEveryResourceShape(Permission permission, ActorRole role)
    {
        var grant = ExpectedGrant(permission, role);
        var actor = role == ActorRole.Guest ? Actor.Guest : new Actor(Self, role);
        var own = new OwnedResource(Self);
        var foreignPrivate = new OwnedResource(Other);
        var foreignPublic = new OwnedResource(Other, isPublic: true);
        var shared = new OwnedResource([Other, Self]);

        var (attempt, onOwn, onForeign, onPublic) = grant switch
        {
            Grant.Deny or Grant.Signature => (false, false, false, false),
            Grant.Public => (true, false, false, true),
            Grant.Allow => (true, true, true, true),
            Grant.Own => (true, true, false, false),
            Grant.Any => (true, true, true, true),
            _ => throw new InvalidOperationException(grant.ToString()),
        };

        Assert.Equal(attempt, Permissions.CanAttempt(actor, permission));
        Assert.Equal(onOwn, Permissions.IsAllowed(actor, permission, own));
        Assert.Equal(onForeign, Permissions.IsAllowed(actor, permission, foreignPrivate));
        Assert.Equal(onPublic, Permissions.IsAllowed(actor, permission, foreignPublic));
        Assert.Equal(onOwn, Permissions.IsAllowed(actor, permission, shared));
    }

    [Fact]
    public void GuestNeverPassesAnOwnershipOrModerationCheck()
    {
        foreach (var permission in Enum.GetValues<Permission>())
        {
            var grant = Permissions.GrantFor(ActorRole.Guest, permission);
            Assert.True(grant is Grant.Deny or Grant.Public or Grant.Signature || permission == Permission.AuthSession,
                $"{permission} gives guests {grant}");
        }
    }

    [Fact]
    public void ForgedActorWithoutUserIdIsNotAuthenticated()
    {
        var forged = new Actor(null, ActorRole.Admin);

        Assert.False(Permissions.CanAttempt(forged, Permission.RolesManage));
        Assert.False(Permissions.IsAllowed(forged, Permission.RolesManage, new OwnedResource(Other)));
        Assert.False(Permissions.IsOwnerOrModerator(forged, new OwnedResource(Other)));
    }

    [Theory]
    [InlineData(ActorRole.User, true, false)]
    [InlineData(ActorRole.Trusted, true, false)]
    [InlineData(ActorRole.Moderator, true, true)]
    [InlineData(ActorRole.Admin, true, true)]
    public void OwnerOrModeratorRule(ActorRole role, bool onOwn, bool onForeign)
    {
        var actor = new Actor(Self, role);

        Assert.Equal(onOwn, Permissions.IsOwnerOrModerator(actor, new OwnedResource(Self)));
        Assert.Equal(onForeign, Permissions.IsOwnerOrModerator(actor, new OwnedResource(Other)));
        Assert.False(Permissions.IsOwnerOrModerator(Actor.Guest, new OwnedResource(Self)));
    }

    private static Grant ExpectedGrant(Permission permission, ActorRole role) =>
        Expected[permission].Split(' ')[(int)role] switch
        {
            "-" => Grant.Deny,
            "P" => Grant.Public,
            "A" => Grant.Allow,
            "O" => Grant.Own,
            "X" => Grant.Any,
            "S" => Grant.Signature,
            var other => throw new InvalidOperationException(other),
        };
}
