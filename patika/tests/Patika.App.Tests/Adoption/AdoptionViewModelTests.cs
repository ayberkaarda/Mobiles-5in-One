#if ANIMAL_FEATURE_TESTS
using System.Net;
using Patika.App.Core.Api;
using Patika.App.Core.Navigation;
using Patika.App.ViewModels.Adoption;
using Patika.Contracts.Adoptions;
using Patika.Contracts.Community;
using Xunit;

namespace Patika.App.Tests.Adoption;

internal sealed class FeatureNavigation : INavigationService
{
    public string? Route { get; private set; }
    public IDictionary<string, object>? Parameters { get; private set; }
    public Task GoToAsync(string route, IDictionary<string, object>? parameters = null) { Route = route; Parameters = parameters; return Task.CompletedTask; }
    public Task GoBackAsync() => Task.CompletedTask;
}

internal static class FeatureApi
{
    public static async Task<PatikaApiClient> CreateAsync(FakeHandler handler, bool signedIn = false)
    {
        var clock = new ManualClock();
        var tokens = new TokenManager(new MemoryTokenStore(), clock);
        if (signedIn) await tokens.AcceptAsync(Http.Tokens(Guid.NewGuid().ToString(), "feature"));
        return new PatikaApiClient(new HttpClient(handler), tokens, new ApiOptions { BaseAddress = new Uri("https://patika.test/") });
    }
    public static AdoptionPostResponse Post(Guid? id = null) => new(id ?? Guid.NewGuid(), Guid.NewGuid(), "Sakin bir dost", "Güvenli ev", "Kadıköy", "Published", DateTimeOffset.UtcNow.AddDays(10), "Pamuk", "Cat", "Healthy", true, true, false, FirstPhotoUrl: "https://patika.test/photo.jpg");
}

public sealed class AdoptionViewModelTests
{
    [Fact]
    public async Task FilterChangesRequireRefreshBeforeMore()
    {
        var rows = Enumerable.Range(0, 20).Select(_ => FeatureApi.Post()).ToArray();
        var handler = new FakeHandler(_ => Http.Done(Http.Json(HttpStatusCode.OK, rows)));
        var model = new AdoptViewModel(await FeatureApi.CreateAsync(handler), new FeatureNavigation(), new FakeNetwork());
        await model.RefreshAsync();
        model.Species = "Köpek";
        await model.LoadMoreAsync();
        Assert.False(model.HasMore);
        Assert.Single(handler.Requests);
    }
    [Fact]
    public async Task EditedRequestUsesNewKey()
    {
        var handler = new FakeHandler(_ => Http.Done(Http.Problem(503, "unavailable")));
        var model = new AdoptionRequestViewModel(await FeatureApi.CreateAsync(handler, true), new FeatureNavigation(), new FakeNetwork()) { Id = Guid.NewGuid(), Message = "İlk mesaj" };
        await model.SubmitAsync();
        model.Message = "Yeni mesaj";
        await model.SubmitAsync();
        Assert.Equal(2, handler.Requests.Select(x => x.IdempotencyKey).Distinct().Count());
    }
    [Fact]
    public async Task ConnectivityObservationStopsWhenPageLeaves()
    {
        var network = new FakeNetwork();
        var handler = new FakeHandler(_ => Http.Done(Http.Json(HttpStatusCode.OK, Array.Empty<AdoptionPostResponse>())));
        var model = new AdoptViewModel(await FeatureApi.CreateAsync(handler), new FeatureNavigation(), network);
        var updates = 0;
        model.PropertyChanged += (_, e) => { if (e.PropertyName == nameof(model.IsOffline)) updates++; };
        model.Activate();
        network.Set(false);
        Assert.True(model.IsOffline);
        Assert.Equal(2, updates);
        model.Deactivate();
        network.Set(true);
        Assert.Equal(2, updates);
    }
    [Fact]
    public async Task FiltersAreEncodedAndFirstPhotoIsUsed()
    {
        var post = FeatureApi.Post();
        var handler = new FakeHandler(_ => Http.Done(Http.Json(HttpStatusCode.OK, new[] { post })));
        var model = new AdoptViewModel(await FeatureApi.CreateAsync(handler), new FeatureNavigation(), new FakeNetwork()) { District = "Kadıköy & Moda", Species = "Kedi" };
        await model.RefreshAsync();
        var request = Assert.Single(handler.Requests);
        Assert.Contains("district=" + Uri.EscapeDataString("Kadıköy & Moda"), request.Path);
        Assert.Contains("species=Cat", request.Path);
        Assert.Equal(post.FirstPhotoUrl, Assert.Single(model.Items).PhotoUrl);
        Assert.False(model.HasMore);
        Assert.False(model.IsBusy);
    }
    [Fact]
    public async Task NextPageAppendsAndRefreshReplaces()
    {
        var first = Enumerable.Range(0, 20).Select(_ => FeatureApi.Post()).ToArray();
        var last = FeatureApi.Post();
        var handler = new FakeHandler(r => Http.Done(Http.Json(HttpStatusCode.OK, r.Path.Contains("page=2") ? new[] { last } : first)));
        var model = new AdoptViewModel(await FeatureApi.CreateAsync(handler), new FeatureNavigation(), new FakeNetwork());
        await model.RefreshAsync();
        Assert.True(model.HasMore);
        await model.LoadMoreAsync();
        Assert.Equal(21, model.Items.Count);
        Assert.False(model.HasMore);
        await model.RefreshAsync();
        Assert.Equal(20, model.Items.Count);
    }
    [Fact]
    public async Task EmptyAndServerErrorAreDistinct()
    {
        var fail = false;
        var handler = new FakeHandler(_ => Http.Done(fail ? Http.Problem(503, "unavailable") : Http.Json(HttpStatusCode.OK, Array.Empty<AdoptionPostResponse>())));
        var model = new AdoptViewModel(await FeatureApi.CreateAsync(handler), new FeatureNavigation(), new FakeNetwork(false));
        await model.RefreshAsync();
        Assert.True(model.IsEmpty);
        Assert.True(model.IsOffline);
        fail = true;
        await model.RefreshAsync();
        Assert.True(model.HasError);
        Assert.False(model.IsEmpty);
        Assert.False(model.IsBusy);
    }
    [Theory]
    [InlineData(0)]
    [InlineData(3001)]
    public async Task InvalidRequestDoesNotSend(int length)
    {
        var handler = new FakeHandler(_ => throw new InvalidOperationException());
        var model = new AdoptionRequestViewModel(await FeatureApi.CreateAsync(handler, true), new FeatureNavigation(), new FakeNetwork()) { Id = Guid.NewGuid(), Message = new string('a', length) };
        await model.SubmitAsync();
        Assert.NotNull(model.ValidationMessage);
        Assert.Empty(handler.Requests);
        Assert.False(model.Succeeded);
    }
    [Fact]
    public async Task WhitespaceRequestDoesNotSend()
    {
        var handler = new FakeHandler(_ => throw new InvalidOperationException());
        var model = new AdoptionRequestViewModel(await FeatureApi.CreateAsync(handler), new FeatureNavigation(), new FakeNetwork()) { Id = Guid.NewGuid(), Message = "   " };
        await model.SubmitAsync();
        Assert.NotNull(model.ValidationMessage);
        Assert.Empty(handler.Requests);
    }
    [Fact]
    public async Task MaximumLengthSucceedsOnce()
    {
        var id = Guid.NewGuid();
        var handler = new FakeHandler(_ => Http.Done(Http.Json(HttpStatusCode.Created, new AdoptionRequestResponse(Guid.NewGuid(), id, "mesaj", null, "Pending"))));
        var model = new AdoptionRequestViewModel(await FeatureApi.CreateAsync(handler, true), new FeatureNavigation(), new FakeNetwork()) { Id = id, Message = new string('a', 3000) };
        await model.SubmitAsync();
        await model.SubmitAsync();
        Assert.True(model.Succeeded);
        Assert.False(model.ShowForm);
        Assert.Single(handler.Requests);
        Assert.Equal("3000 / 3000", model.CharacterCount);
    }
    [Fact]
    public async Task RetryReusesKeyAndPreservesMessage()
    {
        var handler = new FakeHandler(_ => Http.Done(Http.Problem(503, "unavailable")));
        var model = new AdoptionRequestViewModel(await FeatureApi.CreateAsync(handler, true), new FeatureNavigation(), new FakeNetwork()) { Id = Guid.NewGuid(), Message = "Evimi anlatıyorum" };
        await model.SubmitAsync();
        await model.SubmitAsync();
        Assert.True(model.HasError);
        Assert.False(model.Succeeded);
        Assert.Equal("Evimi anlatıyorum", model.Message);
        Assert.Equal(2, handler.Requests.Count);
        Assert.Single(handler.Requests.Select(r => r.IdempotencyKey).Distinct());
    }
    [Fact]
    public async Task DetailRoutesUsePostAndAnimalIds()
    {
        var post = FeatureApi.Post();
        var handler = new FakeHandler(_ => Http.Done(Http.Json(HttpStatusCode.OK, post)));
        var navigation = new FeatureNavigation();
        var model = new AdoptionPostViewModel(await FeatureApi.CreateAsync(handler), navigation, new FakeNetwork()) { Id = post.Id };
        await model.LoadAsync();
        Assert.True(model.CanRequest);
        await model.RequestCommand.ExecuteAsync(null);
        Assert.Equal(Routes.AdoptionRequest, navigation.Route);
        Assert.Equal(post.Id, navigation.Parameters![Routes.Keys.Id]);
        await model.ProfileCommand.ExecuteAsync(null);
        Assert.Equal(Routes.Animal, navigation.Route);
        Assert.Equal(post.AnimalId, navigation.Parameters![Routes.Keys.Id]);
    }
    [Fact]
    public async Task ClosedPostCannotOpenRequest()
    {
        var post = FeatureApi.Post() with { State = "Closed" };
        var navigation = new FeatureNavigation();
        var handler = new FakeHandler(_ => Http.Done(Http.Json(HttpStatusCode.OK, post)));
        var model = new AdoptionPostViewModel(await FeatureApi.CreateAsync(handler), navigation, new FakeNetwork()) { Id = post.Id };
        await model.LoadAsync();
        await model.RequestCommand.ExecuteAsync(null);
        Assert.False(model.CanRequest);
        Assert.Null(navigation.Route);
    }
    [Fact]
    public async Task MyRequestsReadsPagedEnvelopeAndReply()
    {
        var row = new AdoptionRequestResponse(Guid.NewGuid(), Guid.NewGuid(), "Merhaba", "Tanışalım", "Replied");
        var handler = new FakeHandler(_ => Http.Done(Http.Json(HttpStatusCode.OK, new PageResponse<AdoptionRequestResponse>([row], 1, 20, false))));
        var model = new MyAdoptionRequestsViewModel(await FeatureApi.CreateAsync(handler, true), new FakeNetwork());
        await model.RefreshAsync();
        Assert.Contains("/v1/me/adoption-requests?", Assert.Single(handler.Requests).Path);
        Assert.Equal("Tanışalım", Assert.Single(model.Items).Reply);
        Assert.Equal("Yanıtlandı", model.Items[0].State);
    }
}
#endif
