using System.Net;
using Patika.App.Core.Location;
using Patika.App.Core.Navigation;
using Patika.App.Core.Push;
using Patika.App.Tests.Account;
using Patika.App.ViewModels.Urgent;
using Patika.Contracts.CarePlaces;
using Patika.Contracts.Geo;
using Patika.Contracts.Urgent;
using Xunit;

namespace Patika.App.Tests.Urgent;

public sealed class HomeAreaTests
{
    [Theory]
    [InlineData(40.987654321, 40.988)]
    [InlineData(29.02349, 29.023)]
    [InlineData(29.0235, 29.024)]
    [InlineData(-33.86882, -33.869)]
    [InlineData(41.0, 41.0)]
    public void Saved_areas_keep_three_decimals_like_the_api(double raw, double rounded) =>
        Assert.Equal(rounded, HomeArea.Round(raw), 9);

    [Fact]
    public void A_rounded_area_is_never_more_than_about_80_m_from_the_real_point_and_never_more_precise()
    {
        var area = HomeArea.Round(40.987654, 29.031234);

        Assert.Equal(area.Latitude, Math.Round(area.Latitude, 3), 12);
        Assert.Equal(area.Longitude, Math.Round(area.Longitude, 3), 12);
        Assert.InRange(HomeArea.DistanceMeters(40.987654, 29.031234, area.Latitude, area.Longitude), 1, 80);
    }

    [Theory]
    [InlineData(100, 500)]
    [InlineData(500, 500)]
    [InlineData(1400, 1500)]
    [InlineData(1374, 1250)]
    [InlineData(1900, 2000)]
    [InlineData(5000, 2000)]
    public void The_radius_stays_between_500_m_and_2_km_in_250_m_steps(double asked, int snapped) =>
        Assert.Equal(snapped, HomeArea.SnapRadius(asked));

    [Fact]
    public void Distances_and_ages_read_like_the_design()
    {
        var now = new DateTimeOffset(2026, 10, 25, 12, 0, 0, TimeSpan.Zero);
        Assert.Equal("450 m", UrgentText.Distance(447));
        Assert.Equal("1,3 km", UrgentText.Distance(1320));
        Assert.Equal("1,5 km", UrgentText.Radius(1500));
        Assert.Equal("750 m", UrgentText.Radius(750));
        Assert.Equal("2 km", UrgentText.Radius(2000));
        Assert.Equal("14 dk önce", UrgentText.Age(now.AddMinutes(-14), now));
        Assert.Equal("1 sa önce", UrgentText.Age(now.AddMinutes(-75), now));
        Assert.Equal("9 gönüllüye bildirildi", UrgentText.Notified(9));
        Assert.Equal("Sıkışmış", UrgentText.Category("Trapped"));
    }
}

public sealed class UrgentSettingsTests
{
    private static UrgentSettingsResponse Saved(bool optIn, CoordinateDto? area, int radius) => new(optIn, area, radius);

    private static (UrgentSettingsViewModel Model, TestApi Api) Create(FakeLocation location, UrgentSettingsResponse initial)
    {
        var api = new TestApi(r => Http.Done(r switch
        {
            { Path: "/v1/me/urgent-settings", Method.Method: "GET" } => Http.Json(HttpStatusCode.OK, initial),
            { Path: "/v1/me/urgent-settings", Method.Method: "PUT" } => Http.Json(HttpStatusCode.OK, Echo(r)),
            _ => new HttpResponseMessage(HttpStatusCode.NoContent),
        }));
        var push = new PushHarness(api);
        var model = new UrgentSettingsViewModel(new UrgentApi(api.Client), location, push.Registration, new FakeNavigation());
        return (model, api);
    }

    private static UrgentSettingsResponse Echo(RecordedRequest request)
    {
        var body = TestApi.Body(request);
        var optIn = body.GetProperty("optIn").GetBoolean();
        var hasArea = body.TryGetProperty("homeArea", out var area) && area.ValueKind != System.Text.Json.JsonValueKind.Null;
        return new UrgentSettingsResponse(optIn,
            !hasArea
                ? null
                : new CoordinateDto(area.GetProperty("lat").GetDouble(), area.GetProperty("lng").GetDouble()),
            body.GetProperty("radiusMeters").GetInt32());
    }

    [Fact]
    public async Task The_current_position_is_rounded_before_it_is_kept_or_sent()
    {
        var location = new FakeLocation(LocationAccess.Granted, new GeoFix(40.9876543, 29.0312345, 8, DateTimeOffset.UnixEpoch));
        var (model, api) = Create(location, Saved(false, null, 1500));
        await api.SignInAsync();
        await model.LoadAsync();

        await model.UseCurrentPositionCommand.ExecuteAsync(null);
        Assert.Equal(new CoordinateDto(40.988, 29.031), model.Area);

        model.OptIn = true;
        model.Radius = 1400;
        await model.SaveCommand.ExecuteAsync(null);

        var put = Assert.Single(api.Sent("/v1/me/urgent-settings", HttpMethod.Put));
        Assert.DoesNotContain("40.9876543", put.Body, StringComparison.Ordinal);
        var body = TestApi.Body(put);
        Assert.Equal(40.988, body.GetProperty("homeArea").GetProperty("lat").GetDouble());
        Assert.Equal(29.031, body.GetProperty("homeArea").GetProperty("lng").GetDouble());
        Assert.Equal(1500, body.GetProperty("radiusMeters").GetInt32());
        Assert.StartsWith("Kaydedildi.", model.Notice, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Opting_in_needs_an_area_and_opting_out_erases_it()
    {
        var (model, api) = Create(new FakeLocation(LocationAccess.Denied), Saved(true, new CoordinateDto(40.99, 29.03), 1000));
        await api.SignInAsync();
        await model.LoadAsync();
        Assert.Equal(1000, model.RadiusMeters);
        Assert.Equal("1 km", model.RadiusText);

        model.OptIn = false;
        await model.SaveCommand.ExecuteAsync(null);
        var body = TestApi.Body(Assert.Single(api.Sent("/v1/me/urgent-settings", HttpMethod.Put)));
        Assert.False(body.TryGetProperty("homeArea", out _), "opting out sends no area");
        Assert.Null(model.Area);

        model.OptIn = true;
        await model.SaveCommand.ExecuteAsync(null);
        Assert.Equal("Bildirim almak için önce ev bölgeni seç.", model.ErrorMessage);
        Assert.Single(api.Sent("/v1/me/urgent-settings", HttpMethod.Put));
    }

    [Fact]
    public async Task A_picked_point_comes_back_rounded_and_dragging_adds_up()
    {
        var (model, api) = Create(new FakeLocation(), Saved(false, null, 1500));
        model.ApplyQuery(new Dictionary<string, object>
        {
            [UrgentRoutes.LatitudeKey] = 40.98765,
            [UrgentRoutes.LongitudeKey] = 29.02345,
        });
        Assert.Equal(new CoordinateDto(40.988, 29.023), model.Area);

        var pick = new UrgentAreaPickViewModel(new FakeLocation(), new FakeNavigation());
        await pick.ApplyQueryAsync(new Dictionary<string, object>
        {
            [UrgentRoutes.LatitudeKey] = 40.990,
            [UrgentRoutes.LongitudeKey] = 29.030,
        });

        // Ten drags of 30 m north: each alone would round away, together they move the area.
        for (var i = 0; i < 10; i++)
        {
            pick.Move(0, 30);
        }

        Assert.Equal(40.993, pick.Center.Latitude, 9);
        Assert.Equal(29.030, pick.Center.Longitude, 9);
        Assert.Empty(api.Handler.Requests);
    }
}

public sealed class UrgentCreateTests
{
    private static readonly GeoFix Here = new(40.98712, 29.02788, 12, DateTimeOffset.UnixEpoch);

    private static UrgentPostResponse Post(string state = "Open") => new(Guid.Parse("8d3a9b52-6a7e-4b1f-9c51-0e7c2f1a9d44"),
        new CoordinateDto(Here.Latitude, Here.Longitude), "Injured", "Parkın girişinde, arka ayağına basamıyor.",
        "urgent/0f8fad5b-d9cb-469f-a165-70867728950e", state, 0, DateTimeOffset.UnixEpoch, null);

    private static async Task<(UrgentCreateViewModel Model, TestApi Api, FakeNavigation Navigation)> CreateAsync(
        Func<RecordedRequest, HttpResponseMessage> respond)
    {
        var api = new TestApi(r => Http.Done(respond(r)));
        await api.SignInAsync();
        var navigation = new FakeNavigation();
        var model = new UrgentCreateViewModel(new UrgentApi(api.Client), new FakeLocation(LocationAccess.Granted, Here), new FakePhotos(), navigation);
        await model.StartAsync();
        return (model, api, navigation);
    }

    private static async Task FillAsync(UrgentCreateViewModel model)
    {
        await model.TakePhotoCommand.ExecuteAsync(null);
        model.SelectCategoryCommand.Execute("Injured");
        model.Note = "Parkın girişinde, arka ayağına basamıyor.";
    }

    [Fact]
    public async Task The_fourth_post_of_the_day_shows_the_cap_and_the_form_stops_sending()
    {
        var (model, api, navigation) = await CreateAsync(_ => Http.Problem(429, "urgent_daily_cap"));
        await FillAsync(model);
        Assert.True(model.CanSend);

        await model.SendCommand.ExecuteAsync(null);

        Assert.True(model.CapReached);
        Assert.False(model.CanSend);
        Assert.Equal(UrgentText.DailyCap, model.ErrorMessage);
        Assert.StartsWith("Bugün en fazla 3 acil çağrı açabilirsin.", model.ErrorMessage, StringComparison.Ordinal);

        await model.SendCommand.ExecuteAsync(null);
        Assert.Single(api.Sent("/v1/urgent", HttpMethod.Post));
        Assert.Empty(navigation.Visits);
    }

    [Fact]
    public async Task A_retry_after_a_lost_response_reuses_the_draft_key()
    {
        var calls = 0;
        var (model, api, navigation) = await CreateAsync(r => ++calls == 1
            ? Http.Problem(503, "http_503")
            : Http.Json(HttpStatusCode.Created, Post()));
        await FillAsync(model);

        await model.SendCommand.ExecuteAsync(null);
        Assert.False(model.CapReached);
        Assert.NotNull(model.ErrorMessage);
        await model.SendCommand.ExecuteAsync(null);

        var posts = api.Sent("/v1/urgent", HttpMethod.Post);
        Assert.Equal(2, posts.Count);
        Assert.Equal(posts[0].IdempotencyKey, posts[1].IdempotencyKey);
        var body = TestApi.Body(posts[1]);
        Assert.Equal("Injured", body.GetProperty("category").GetString());
        Assert.Equal("urgent/0f8fad5b-d9cb-469f-a165-70867728950e", body.GetProperty("photoKey").GetString());
        Assert.Equal("../" + UrgentRoutes.Detail, navigation.Last);
        Assert.Equal(Post().Id, navigation.Visits[^1].Parameters![Routes.Keys.Id]);
    }

    [Theory]
    [InlineData(false, "Injured", "Parkın girişinde bekliyorum.", "Bir fotoğraf ekle; gönüllüler hayvanı tanısın.")]
    [InlineData(true, null, "Parkın girişinde bekliyorum.", "Ne olduğunu seç.")]
    [InlineData(true, "Sick", "kısa", "Kısa bir not yaz (en az 10 karakter).")]
    public async Task Missing_parts_are_named_before_anything_is_sent(bool photo, string? category, string note, string message)
    {
        var (model, api, _) = await CreateAsync(_ => Http.Json(HttpStatusCode.Created, Post()));
        if (photo)
        {
            await model.TakePhotoCommand.ExecuteAsync(null);
        }

        if (category is not null)
        {
            model.SelectCategoryCommand.Execute(category);
        }

        model.Note = note;
        await model.SendCommand.ExecuteAsync(null);

        Assert.Equal(message, model.ErrorMessage);
        Assert.Empty(api.Sent("/v1/urgent", HttpMethod.Post));
    }

    [Fact]
    public async Task Without_location_access_the_form_cannot_send()
    {
        var api = new TestApi(_ => Http.Done(new HttpResponseMessage(HttpStatusCode.NoContent)));
        await api.SignInAsync();
        var model = new UrgentCreateViewModel(new UrgentApi(api.Client), new FakeLocation(LocationAccess.Blocked), new FakePhotos(),
            new FakeNavigation());

        await model.StartAsync();

        Assert.False(model.HasLocation);
        Assert.False(model.CanSend);
        Assert.Contains("ayarlarından", model.LocationText, StringComparison.Ordinal);
    }
}

public sealed class UrgentListTests
{
    [Fact]
    public async Task Without_location_the_list_asks_first_and_sends_nothing()
    {
        var api = new TestApi(_ => Http.Done(new HttpResponseMessage(HttpStatusCode.NoContent)));
        var model = new UrgentListViewModel(new UrgentApi(api.Client), new FakeLocation(LocationAccess.Denied), new FakeNavigation(),
            new FakeLauncher(), api.Clock);

        await model.LoadAsync();

        Assert.True(model.NeedsLocation);
        Assert.Empty(api.Handler.Requests);
    }

    [Fact]
    public async Task Open_posts_and_care_places_load_around_the_current_position()
    {
        var here = new GeoFix(40.9871, 29.0279, 10, DateTimeOffset.UnixEpoch);
        var api = new TestApi(r => Http.Done(r.Path.StartsWith("/v1/urgent", StringComparison.Ordinal)
            ? Http.Json(HttpStatusCode.OK, new UrgentPostListResponse(
            [
                new UrgentPostResponse(Guid.NewGuid(), new CoordinateDto(40.9900, 29.0279), "Injured", "Arka ayağına basamıyor.",
                    "urgent/0f8fad5b-d9cb-469f-a165-70867728950e", "Open", 9, DateTimeOffset.UnixEpoch, 450),
                new UrgentPostResponse(Guid.NewGuid(), new CoordinateDto(40.9900, 29.0279), "Other", "Bu çağrı kapandı.",
                    "urgent/0f8fad5b-d9cb-469f-a165-70867728950e", "Closed", 2, DateTimeOffset.UnixEpoch, 500),
            ]))
            : Http.Json(HttpStatusCode.OK, new[]
            {
                new CarePlaceResponse(Guid.NewGuid(), "Kuşdili Veteriner Kliniği", "Vet", 40.9900, 29.0300, "Kuşdili Cd.", "+90 216 000 00 00",
                    null, true, true, true),
            })));
        var launcher = new FakeLauncher();
        var model = new UrgentListViewModel(new UrgentApi(api.Client), new FakeLocation(LocationAccess.Granted, here), new FakeNavigation(),
            launcher, api.Clock);

        await model.LoadAsync();

        Assert.True(model.IsReady);
        var row = Assert.Single(model.Posts);
        Assert.Equal("Yaralı", row.Category);
        Assert.Equal("450 m", row.Distance);
        Assert.Contains("near=40.9871,29.0279", api.Sent("/v1/urgent")[0].Path, StringComparison.Ordinal);
        var place = Assert.Single(model.CarePlaces);
        Assert.Equal("24 saat açık", place.Hours);

        await model.CallCommand.ExecuteAsync(place);
        Assert.Equal("tel:+902160000000", Assert.Single(launcher.Opened));
    }

    [Fact]
    public void Push_messages_for_a_build_without_firebase_say_so_plainly() =>
        Assert.Equal("Bu sürümde bildirimler henüz kurulmadı.", PushMessages.NotConfigured);
}
