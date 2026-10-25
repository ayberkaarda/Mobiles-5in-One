using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Patika.Api.Features.Auth;
using Patika.Api.Security.Tokens;
using Patika.Api.Tests.Infrastructure;
using Patika.Contracts.Admin;
using Patika.Domain.Security;
using Xunit;

namespace Patika.SecurityTests.Admin;

public sealed class AdminAuthorizationTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Theory]
    [InlineData(ActorRole.Guest, false)]
    [InlineData(ActorRole.User, false)]
    [InlineData(ActorRole.Trusted, false)]
    [InlineData(ActorRole.Moderator, false)]
    [InlineData(ActorRole.Moderator, true)]
    [InlineData(ActorRole.Admin, true)]
    public async Task EveryAdminRouteEnforcesItsPolicyBeforeValidation(ActorRole role, bool mfa)
    {
        await using var factory = new PatikaApiFactory();
        using var client = factory.CreateApiClient();
        if (role != ActorRole.Guest)
        {
            var id = Guid.CreateVersion7();
            await factory.Store.TryCreateUserAsync(new AuthUser(id, "admin@example.org", null, "Review", role, DateTimeOffset.UtcNow, null), null, null, Ct);
            var issuer = factory.Services.GetRequiredService<IAccessTokenIssuer>();
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", issuer.Issue(id, role, mfa ? "mfa" : null).Token);
        }
        var user = Guid.CreateVersion7();
        (HttpMethod Method, string Path, object? Body, bool Manage, HttpStatusCode Allowed)[] routes =
        [
            (HttpMethod.Get, "/queue?type=invalid", null, false, HttpStatusCode.BadRequest),
            (HttpMethod.Post, "/decisions", new AdminDecisionRequest("bad", user, "bad", null), false, HttpStatusCode.BadRequest),
            (HttpMethod.Post, "/step-up", new StepUpRequest("000000", "bad"), false, HttpStatusCode.BadRequest),
            (HttpMethod.Get, "/users?q=bad", null, true, HttpStatusCode.BadRequest),
            (HttpMethod.Post, $"/users/{user}/role", new AdminRoleRequest("bad"), true, HttpStatusCode.BadRequest),
            (HttpMethod.Post, $"/users/{user}/suspend", new AdminSuspendRequest(null, "bad"), true, HttpStatusCode.BadRequest),
            (HttpMethod.Get, "/audit?cursor=invalid", null, true, HttpStatusCode.BadRequest),
            (HttpMethod.Post, "/care-places/csv/preview", new { }, true, HttpStatusCode.UnsupportedMediaType),
            (HttpMethod.Post, "/care-places/csv/commit", new { }, true, HttpStatusCode.UnsupportedMediaType),
        ];
        foreach (var route in routes)
        {
            using var request = new HttpRequestMessage(route.Method, "/v1/admin" + route.Path);
            if (route.Body is not null) request.Content = JsonContent.Create(route.Body);
            using var response = await client.SendAsync(request, Ct);
            var expected = role == ActorRole.Guest ? HttpStatusCode.Unauthorized
                : !mfa || role is not (ActorRole.Moderator or ActorRole.Admin) || (route.Manage && role != ActorRole.Admin)
                    ? HttpStatusCode.Forbidden : route.Allowed;
            Assert.True(response.StatusCode == expected, $"{role} mfa={mfa} {route.Path}: expected {expected}, got {response.StatusCode}");
            Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
            if (role == ActorRole.Moderator && !mfa) Assert.Contains("mfa_required", await response.Content.ReadAsStringAsync(Ct));
        }
    }

    [Fact]
    public async Task DemotionIsEffectiveOnTheNextRequest()
    {
        await using var factory = new PatikaApiFactory();
        using var client = factory.CreateApiClient();
        var id = Guid.CreateVersion7();
        await factory.Store.TryCreateUserAsync(new AuthUser(id, null, null, "Review", ActorRole.Admin, DateTimeOffset.UtcNow, null), null, null, Ct);
        var token = factory.Services.GetRequiredService<IAccessTokenIssuer>().Issue(id, ActorRole.Admin, "mfa").Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/v1/admin/queue?type=bad", Ct)).StatusCode);
        factory.Store.Update(id, u => u with { Role = ActorRole.User });
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/v1/admin/queue?type=bad", Ct)).StatusCode);
    }
}
