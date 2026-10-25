#if ANIMAL_FEATURE_TESTS
using System.Net;
using Patika.App.Core.Api;
using Patika.App.Core.Offline;
using Patika.App.Tests.Adoption;
using Patika.App.ViewModels.Animals;
using Patika.Contracts.Community;
using Patika.Contracts.Geo;
using Xunit;

namespace Patika.App.Tests.Animals;

public sealed class AnimalViewModelTests
{
    private static AnimalResponse Animal() => new(Guid.NewGuid(), null, new CoordinateDto(41, 29), "Cat", "Pamuk", "Female", true, true, false, "Healthy", "Kadıköy", false, 7);
    private static HttpResponseMessage Respond(RecordedRequest request, AnimalResponse animal)
    {
        if (request.Path.Contains("/photos")) return Http.Json(HttpStatusCode.OK, new PageResponse<AnimalPhotoResponse>([new(Guid.NewGuid(), "key", "https://patika.test/cat.jpg")], 1, 20, false));
        if (request.Path.Contains("/sightings")) return Http.Json(HttpStatusCode.OK, new PageResponse<SightingResponse>([], 1, 20, false));
        if (request.Path.EndsWith("/follow", StringComparison.Ordinal)) return new(HttpStatusCode.NoContent);
        return Http.Json(HttpStatusCode.OK, animal);
    }
    [Fact]
    public async Task ProfileUsesPhotoUrlAndServerFollowState()
    {
        var animal = Animal() with { IsFollowing = true };
        var handler = new FakeHandler(r => Http.Done(Respond(r, animal)));
        var model = new AnimalViewModel(await FeatureApi.CreateAsync(handler), (_, _) => throw new InvalidOperationException(), new FakeNetwork()) { Id = animal.Id };
        await model.LoadAsync();
        Assert.Equal("Takibi bırak", model.FollowText);
        Assert.Equal("7 takipçi", model.Followers);
        Assert.Equal("https://patika.test/cat.jpg", Assert.Single(model.Photos).PhotoUrl);
        Assert.True(model.NoSightings);
        Assert.Contains("Kısırlaştırıldı", model.Health);
        Assert.Contains("Aşılı", model.Health);
        Assert.Contains("Küpesiz", model.Health);
    }
    [Fact]
    public async Task FollowAndUnfollowOnlyUpdateAfterSuccess()
    {
        var animal = Animal();
        var handler = new FakeHandler(r => Http.Done(Respond(r, animal)));
        var model = new AnimalViewModel(await FeatureApi.CreateAsync(handler, true), (_, _) => throw new InvalidOperationException(), new FakeNetwork()) { Id = animal.Id };
        await model.LoadAsync();
        await model.ToggleFollowAsync();
        Assert.True(model.Animal!.IsFollowing);
        Assert.Equal(8, model.Animal.FollowerCount);
        await model.ToggleFollowAsync();
        Assert.False(model.Animal.IsFollowing);
        Assert.Equal(7, model.Animal.FollowerCount);
        Assert.Contains(handler.Requests, r => r.Method == HttpMethod.Put);
        Assert.Contains(handler.Requests, r => r.Method == HttpMethod.Delete);
    }
    [Fact]
    public async Task FailedFollowPreservesCount()
    {
        var animal = Animal();
        var handler = new FakeHandler(r => Http.Done(r.Path.EndsWith("/follow", StringComparison.Ordinal) ? Http.Problem(403, "forbidden") : Respond(r, animal)));
        var model = new AnimalViewModel(await FeatureApi.CreateAsync(handler, true), (_, _) => throw new InvalidOperationException(), new FakeNetwork()) { Id = animal.Id };
        await model.LoadAsync();
        await model.ToggleFollowAsync();
        Assert.True(model.HasError);
        Assert.False(model.Animal!.IsFollowing);
        Assert.Equal(7, model.Animal.FollowerCount);
    }
    [Fact]
    public async Task OfflineSightingUsesOutboxAction()
    {
        using var database = new TempDatabase();
        var animal = Animal();
        var handler = new FakeHandler(r => Http.Done(Respond(r, animal)));
        var api = await FeatureApi.CreateAsync(handler, true);
        var network = new FakeNetwork(false);
        var clock = new ManualClock();
        var outbox = new Outbox(database.Database, clock);
        using var replayer = new OutboxReplayer(outbox, new ApiOutboxSender(api), api.Tokens, network, clock);
        var actions = new FieldActions(outbox, replayer, api.Tokens, network);
        var model = new AnimalViewModel(api, actions, network) { Id = animal.Id, SightingNote = "Parkta" };
        await model.LoadAsync();
        await model.SightAsync();
        Assert.Contains("Bağlantı gelince", model.Notice);
        Assert.DoesNotContain(handler.Requests, r => r.Method == HttpMethod.Post);
        var queued = Assert.Single(await outbox.ListAsync(api.Tokens.UserId!, TestContext.Current.CancellationToken));
        Assert.Equal(OutboxKinds.Sighting, queued.Kind);
        Assert.Equal(animal.Id.ToString(), queued.TargetId);
        Assert.Contains("Parkta", queued.Payload);
        Assert.False(model.HasError);
    }
    [Fact]
    public async Task NetworkFailureClearsBusyAndShowsError()
    {
        var handler = new FakeHandler(_ => throw new HttpRequestException());
        var model = new AnimalViewModel(await FeatureApi.CreateAsync(handler), (_, _) => throw new InvalidOperationException(), new FakeNetwork(false)) { Id = Guid.NewGuid() };
        await model.LoadAsync();
        Assert.True(model.HasError);
        Assert.True(model.IsOffline);
        Assert.False(model.IsBusy);
        Assert.Null(model.Animal);
    }
}
#endif
