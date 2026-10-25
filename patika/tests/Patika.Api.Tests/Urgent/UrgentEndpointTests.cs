using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Patika.Api.Features.Media;
using Patika.Api.Tests.Media;
using Patika.Contracts.Geo;
using Patika.Contracts.Media;
using Patika.Contracts.Urgent;
using Patika.Domain.Security;
using Patika.Infrastructure.Media;
using Xunit;

namespace Patika.Api.Tests.Urgent;

public sealed class UrgentEndpointTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static readonly CoordinateDto Kadikoy = new(40.9909, 29.0303);

    private static string OwnedPhoto(FeatureHost host, Guid userId, string kind = "urgent")
    {
        var id = Guid.CreateVersion7();
        var key = MediaKeys.PhotoKey(kind, id);
        host.Stores.Uploads.Reservations.Add(new UploadReservation(id, userId, kind, key, "image/jpeg", 1000, DateTimeOffset.UtcNow));
        return key;
    }

    private static Task<HttpResponseMessage> CreateAsync(HttpClient client, string photoKey, CoordinateDto? location = null,
        string category = "Injured", string description = "Yaralı bir kedi, arka bacağı kanıyor") =>
        client.PostAsJsonAsync("/v1/urgent", new CreateUrgentPostRequest(location ?? Kadikoy, category, description, photoKey), Ct);

    private static async Task<string> CodeAsync(HttpResponseMessage response)
    {
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct));
        return body.RootElement.GetProperty("code").GetString()!;
    }

    [Fact]
    public async Task ThreeUrgentPostsPerDayThenTheFourthIsRefused()
    {
        await using var host = await FeatureHost.StartAsync();
        var (userId, client) = await host.SignInAsync();

        for (var i = 0; i < 3; i++)
        {
            using var created = await CreateAsync(client, OwnedPhoto(host, userId));
            Assert.Equal(HttpStatusCode.Created, created.StatusCode);
            var post = (await created.Content.ReadFromJsonAsync<UrgentPostResponse>(Ct))!;
            Assert.Equal("Open", post.State);
            Assert.Equal(0, post.NotifiedCount);
        }

        using var refused = await CreateAsync(client, OwnedPhoto(host, userId));

        Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);
        Assert.Equal(UrgentErrorCodes.DailyCapReached, await CodeAsync(refused));
        Assert.True(refused.Headers.RetryAfter?.Delta > TimeSpan.Zero);
        Assert.Equal(3, host.Stores.Urgent.Posts.Count);
    }

    [Fact]
    public async Task PhotoMustBeAnUrgentUploadOfTheCaller()
    {
        await using var host = await FeatureHost.StartAsync();
        var (userId, client) = await host.SignInAsync();
        var (strangerId, _) = await host.SignInAsync();

        using var foreign = await CreateAsync(client, OwnedPhoto(host, strangerId));
        using var wrongKind = await CreateAsync(client, OwnedPhoto(host, userId, "station"));
        using var invented = await CreateAsync(client, MediaKeys.PhotoKey("urgent", Guid.CreateVersion7()));
        var quarantined = OwnedPhoto(host, userId);
        host.Stores.Uploads.Quarantined.Add(quarantined);
        using var rejected = await CreateAsync(client, quarantined);

        Assert.Equal(HttpStatusCode.BadRequest, foreign.StatusCode);
        Assert.Equal(UrgentErrorCodes.PhotoNotFound, await CodeAsync(foreign));
        Assert.Equal(HttpStatusCode.BadRequest, wrongKind.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, invented.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
        Assert.Empty(host.Stores.Urgent.Posts);
    }

    [Theory]
    [InlineData(48.8566, 2.3522, "Injured", "Yaralı bir kedi, arka bacağı kanıyor")]
    [InlineData(40.99, 29.03, "Lost", "Yaralı bir kedi, arka bacağı kanıyor")]
    [InlineData(40.99, 29.03, "injured", "Yaralı bir kedi, arka bacağı kanıyor")]
    [InlineData(40.99, 29.03, "Sick", "kısa")]
    [InlineData(40.99, 29.03, "Sick", "Yaralı‮ kedi, arka bacağı kanıyor")]
    public async Task InvalidPostsAreRejected(double lat, double lng, string category, string description)
    {
        await using var host = await FeatureHost.StartAsync();
        var (userId, client) = await host.SignInAsync();

        using var response = await CreateAsync(client, OwnedPhoto(host, userId), new CoordinateDto(lat, lng), category, description);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(host.Stores.Urgent.Posts);
    }

    [Fact]
    public async Task GuestsCanReadButNotPost()
    {
        await using var host = await FeatureHost.StartAsync();
        var (userId, client) = await host.SignInAsync();
        using var created = await CreateAsync(client, OwnedPhoto(host, userId));
        var post = (await created.Content.ReadFromJsonAsync<UrgentPostResponse>(Ct))!;

        using var anonymousPost = await CreateAsync(host.Client, OwnedPhoto(host, userId));
        var near = await host.Client.GetFromJsonAsync<UrgentPostListResponse>("/v1/urgent?near=40.9915,29.0303&radius=2000", Ct);
        var farAway = await host.Client.GetFromJsonAsync<UrgentPostListResponse>("/v1/urgent?near=39.93,32.85", Ct);
        using var badQuery = await host.Client.GetAsync("/v1/urgent?near=40.99&radius=99999", Ct);

        Assert.Equal(HttpStatusCode.Unauthorized, anonymousPost.StatusCode);
        var item = Assert.Single(near!.Items);
        Assert.Equal(post.Id, item.Id);
        Assert.InRange(item.DistanceMeters!.Value, 50, 90);
        Assert.Empty(farAway!.Items);
        Assert.Equal(HttpStatusCode.BadRequest, badQuery.StatusCode);
        using var raw = await host.Client.GetAsync($"/v1/urgent/{post.Id}", Ct);
        Assert.DoesNotContain("createdBy", await raw.Content.ReadAsStringAsync(Ct), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task OnlyTheAuthorOrAModeratorChangesStateAndNeverBackToOpen()
    {
        await using var host = await FeatureHost.StartAsync();
        var (userId, author) = await host.SignInAsync();
        var (_, stranger) = await host.SignInAsync();
        var (_, moderator) = await host.SignInAsync(ActorRole.Moderator);
        using var created = await CreateAsync(author, OwnedPhoto(host, userId));
        var id = (await created.Content.ReadFromJsonAsync<UrgentPostResponse>(Ct))!.Id;

        Task<HttpResponseMessage> Patch(HttpClient client, string state) =>
            client.PatchAsJsonAsync($"/v1/urgent/{id}", new UpdateUrgentPostRequest(state), Ct);

        using var byStranger = await Patch(stranger, "Closed");
        using var reopen = await Patch(author, "Open");
        using var handled = await Patch(author, "Handled");
        using var closed = await Patch(moderator, "Closed");
        using var again = await Patch(author, "Handled");
        using var missing = await author.PatchAsJsonAsync($"/v1/urgent/{Guid.CreateVersion7()}", new UpdateUrgentPostRequest("Closed"), Ct);

        Assert.Equal(HttpStatusCode.Forbidden, byStranger.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, reopen.StatusCode);
        Assert.Equal(HttpStatusCode.OK, handled.StatusCode);
        Assert.Equal(HttpStatusCode.OK, closed.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal(UrgentErrorCodes.InvalidTransition, await CodeAsync(again));
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.Equal(Patika.Domain.Entities.UrgentPostState.Closed, host.Stores.Urgent.Posts[id].State);
    }
}
