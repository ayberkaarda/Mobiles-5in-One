using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.DependencyInjection;
using Patika.Api.Security.Authorization;
using Patika.Api.Security.Tokens;
using Patika.Api.Tests.Infrastructure;
using Patika.Contracts.Auth;
using Patika.Domain.Security;
using Xunit;
using static Patika.Api.Tests.Infrastructure.ApiTestClient;

namespace Patika.SecurityTests;

/// <summary>
/// IDOR harness. <see cref="IdorHarness"/> drives the real authorization service and the real HTTP
/// pipeline with two users, A (attacker) and B (victim). Later phases add their resources to
/// <see cref="HttpCases"/> (adoption posts, adoption requests, station edits) and to the owned-permission
/// sweep, which already covers every <see cref="Grant.Own"/> cell of the matrix.
/// </summary>
public sealed class IdorTests : IAsyncLifetime
{
    private readonly PatikaApiFactory factory = new();
    private IdorHarness harness = null!;

    public async ValueTask InitializeAsync() => harness = await IdorHarness.CreateAsync(factory);

    public async ValueTask DisposeAsync()
    {
        harness.Dispose();
        await factory.DisposeAsync();
    }

    public static TheoryData<Permission> OwnedByUser()
    {
        var data = new TheoryData<Permission>();
        foreach (var permission in Permissions.All.Where(p => Permissions.GrantFor(ActorRole.User, p) == Grant.Own))
        {
            data.Add(permission);
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(OwnedByUser))]
    public async Task UserACannotActOnUserBsResource(Permission permission)
    {
        var resourceOfB = new OwnedResource(harness.VictimId);
        var resourceOfA = new OwnedResource(harness.AttackerId);

        Assert.False(await harness.AuthorizeAsync(harness.AttackerId, ActorRole.User, resourceOfB, permission));
        Assert.True(await harness.AuthorizeAsync(harness.AttackerId, ActorRole.User, resourceOfA, permission));
        if (Permissions.GrantFor(ActorRole.Trusted, permission) == Grant.Own)
        {
            Assert.False(await harness.AuthorizeAsync(harness.AttackerId, ActorRole.Trusted, resourceOfB, permission));
        }

        Assert.False(await harness.AuthorizeAsync(null, ActorRole.Guest, resourceOfB, permission));
    }

    [Theory]
    [MemberData(nameof(OwnedByUser))]
    public async Task ModeratorReachesForeignResourcesOnlyWhereTheMatrixSaysAny(Permission permission)
    {
        var resourceOfB = new OwnedResource(harness.VictimId);
        var expected = Permissions.GrantFor(ActorRole.Moderator, permission) == Grant.Any;

        Assert.Equal(expected, await harness.AuthorizeAsync(harness.AttackerId, ActorRole.Moderator, resourceOfB, permission));
    }

    [Fact]
    public async Task OwnerOrModeratorRequirementBlocksCrossUserAccess()
    {
        var resourceOfB = new OwnedResource(harness.VictimId);

        Assert.False(await harness.AuthorizeRequirementAsync(harness.AttackerId, ActorRole.User, resourceOfB));
        Assert.True(await harness.AuthorizeRequirementAsync(harness.VictimId, ActorRole.User, resourceOfB));
        Assert.True(await harness.AuthorizeRequirementAsync(harness.AttackerId, ActorRole.Moderator, resourceOfB));
    }

    public static TheoryData<string> HttpCases() => ["me-with-forged-subject", "me-with-own-token", "me-with-role-escalation"];

    [Theory]
    [MemberData(nameof(HttpCases))]
    public async Task HttpCaseDeniesAccessToUserB(string name)
    {
        switch (name)
        {
            case "me-with-forged-subject":
                // A signs a token for B's id with a key of A's choosing.
                var forged = JwtForge.Sign(harness.VictimId, ActorRole.User, JwtForge.AttackerKey());
                await harness.AssertDeniedAsync(forged);
                break;
            case "me-with-own-token":
                // A's genuine token only ever yields A's profile.
                using (var response = await harness.Client.GetMeAsync(harness.AttackerTokens.AccessToken))
                {
                    var me = await response.Content.ReadFromJsonAsync<MeResponse>(Ct);
                    Assert.Equal(harness.AttackerId, me!.Id);
                    Assert.NotEqual(harness.VictimEmail, me.Email);
                }

                break;
            case "me-with-role-escalation":
                // A correctly signed token whose role no longer matches the account is refused.
                var escalated = JwtForge.Sign(harness.AttackerId, ActorRole.Admin, JwtForge.ServerKey());
                await harness.AssertDeniedAsync(escalated);
                break;
            default:
                throw new InvalidOperationException(name);
        }
    }

    [Fact]
    public async Task LogoutWithAnotherUsersAccessTokenDoesNotTouchTheirSession()
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/v1/auth/logout")
        {
            Content = JsonContent.Create(new LogoutRequest(harness.AttackerTokens.RefreshToken)),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", harness.VictimTokens.AccessToken);
        using var logout = await harness.Client.SendAsync(request, Ct);
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);

        using var victimRefresh = await harness.Client.RefreshAsync(harness.VictimTokens.RefreshToken);
        Assert.Equal(HttpStatusCode.OK, victimRefresh.StatusCode);
    }
}

public sealed class IdorHarness : IDisposable
{
    private readonly PatikaApiFactory factory;

    private IdorHarness(PatikaApiFactory factory, HttpClient client)
    {
        this.factory = factory;
        Client = client;
    }

    public HttpClient Client { get; }

    public Guid AttackerId { get; private set; }

    public Guid VictimId { get; private set; }

    public string VictimEmail { get; private set; } = "";

    public TokenResponse AttackerTokens { get; private set; } = null!;

    public TokenResponse VictimTokens { get; private set; } = null!;

    public static async Task<IdorHarness> CreateAsync(PatikaApiFactory factory)
    {
        var harness = new IdorHarness(factory, factory.CreateApiClient());
        var attackerEmail = NewEmail("a");
        harness.VictimEmail = NewEmail("b");
        harness.AttackerTokens = await harness.Client.RegisterAsync(factory, attackerEmail);
        harness.VictimTokens = await harness.Client.RegisterAsync(factory, harness.VictimEmail);
        harness.AttackerId = factory.Store.Users.Single(u => u.Email == attackerEmail).Id;
        harness.VictimId = factory.Store.Users.Single(u => u.Email == harness.VictimEmail).Id;
        return harness;
    }

    public async Task<bool> AuthorizeAsync(Guid? userId, ActorRole role, IProtectedResource resource, Permission permission)
    {
        var authorization = factory.Services.GetRequiredService<IAuthorizationService>();
        return await authorization.IsAllowedAsync(Principal(userId, role), resource, permission);
    }

    public async Task<bool> AuthorizeRequirementAsync(Guid userId, ActorRole role, IProtectedResource resource)
    {
        var authorization = factory.Services.GetRequiredService<IAuthorizationService>();
        var result = await authorization.AuthorizeAsync(Principal(userId, role), resource, OwnerOrModeratorRequirement.Instance);
        return result.Succeeded;
    }

    /// <summary>The request must not succeed: 401, 403 or 404 are all acceptable denials.</summary>
    public async Task AssertDeniedAsync(string accessToken)
    {
        using var response = await Client.GetMeAsync(accessToken);
        Assert.Contains(response.StatusCode, new[] { HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden, HttpStatusCode.NotFound });
        var body = await response.Content.ReadAsStringAsync(Ct);
        Assert.DoesNotContain(VictimEmail, body, StringComparison.OrdinalIgnoreCase);
    }

    public void Dispose() => Client.Dispose();

    private static ClaimsPrincipal Principal(Guid? userId, ActorRole role)
    {
        if (userId is null)
        {
            return new ClaimsPrincipal(new ClaimsIdentity());
        }

        return new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(PatikaClaims.Subject, userId.Value.ToString()), new Claim(PatikaClaims.Role, role.ToString())],
            authenticationType: "test"));
    }
}
