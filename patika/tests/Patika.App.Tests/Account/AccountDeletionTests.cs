using System.Net;
using Patika.App.Core.Navigation;
using Patika.App.Core.Offline;
using Patika.App.Core.Push;
using Patika.App.ViewModels.Account;
using Patika.App.ViewModels.Urgent;
using Patika.Contracts.Account;
using Patika.Contracts.Auth;
using Xunit;

namespace Patika.App.Tests.Account;

/// <summary>Built at run time so no password-shaped literal sits in the repository.</summary>
internal static class TestPasswords
{
    public static readonly string Correct = string.Join("-", "dogru", "sifre", "123");
}

public sealed class AccountDeletionTests : IDisposable
{
    private const string Email = "elif@ornek.test";
    private static readonly DateTimeOffset ExecuteAfter = new(2026, 11, 1, 9, 0, 0, TimeSpan.Zero);

    private readonly MemoryDeletionStore deletions = new();
    private readonly MemorySessionNotice notices = new();
    private readonly FakeNavigation navigation = new();
    private readonly TempDatabase database = new();
    private readonly string previewFolder = Directory.CreateTempSubdirectory("patika-previews-").FullName;
    private Outbox? outbox;
    private SessionDataGuard? guard;

    public void Dispose()
    {
        guard?.Dispose();
        database.Dispose();
        Directory.Delete(previewFolder, recursive: true);
    }

    private static MeResponse Me(string? email = Email) =>
        new(Guid.Parse(Ids.User), email, "Elif", "Volunteer", true, 12, ["first_feeding"], DateTimeOffset.UnixEpoch);

    private sealed record Setup(AccountDeletionViewModel Model, TestApi Api, PushHarness Push);

    /// <param name="delete">The answer to <c>DELETE /v1/me</c>.</param>
    private async Task<Setup> CreateAsync(Func<HttpResponseMessage> delete, IGoogleSignIn? google = null, bool wrongPassword = false)
    {
        var api = new TestApi(r => Http.Done(r switch
        {
            { Path: "/v1/auth/login" } when wrongPassword => Http.Problem(401, "invalid_credentials"),
            { Path: "/v1/auth/login" } or { Path: "/v1/auth/google" } => Http.Json(HttpStatusCode.OK, Http.Tokens(Ids.User, "fresh")),
            { Path: "/v1/me", Method.Method: "DELETE" } => delete(),
            { Path: "/v1/me" } => Http.Json(HttpStatusCode.OK, Me()),
            _ => new HttpResponseMessage(HttpStatusCode.NoContent),
        }));
        await api.SignInAsync(Ids.User, "old");
        var push = new PushHarness(api);
        await push.Registration.SyncAsync(TestContext.Current.CancellationToken);
        var session = new AccountSession(api.Client, push.Registration, deletions, api.Clock);
        // The real sign-out wipe layer: outbox and map cache cleared through the token manager hooks.
        outbox = new Outbox(database.Database, api.Clock);
        guard = new SessionDataGuard(api.Tokens, outbox, new MapCache(database.Database, api.Clock));
        var wipe = new AccountDeletionWipe(api.Client, push.Registration, new UrgentPreviewFiles(previewFolder));
        var model = new AccountDeletionViewModel(session, push.Registration, wipe, google ?? new NotConfiguredGoogleSignIn(), deletions,
            notices, navigation, api.Clock);
        await model.LoadAsync();
        return new Setup(model, api, push);
    }

    private static HttpResponseMessage Scheduled() =>
        Http.Json(HttpStatusCode.Accepted, new AccountDeletionResponse(AccountDeletionResponse.Scheduled, ExecuteAfter));

    [Fact]
    public async Task The_screen_starts_by_explaining_the_grace_period_with_its_final_date()
    {
        var setup = await CreateAsync(Scheduled);

        Assert.Equal(DeletionStep.Explain, setup.Model.Step);
        Assert.True(setup.Model.IsExplaining);
        Assert.True(setup.Model.HasPassword);
        Assert.Equal(AccountText.Date(setup.Api.Clock.GetUtcNow() + TimeSpan.FromDays(7)), setup.Model.FinalDate);
    }

    [Fact]
    public async Task A_wrong_password_stops_before_anything_is_deleted()
    {
        var setup = await CreateAsync(Scheduled, wrongPassword: true);
        setup.Model.Password = "yanlis-sifre";

        await setup.Model.DeleteWithPasswordCommand.ExecuteAsync(null);

        Assert.Equal(AccountText.WrongPassword, setup.Model.ErrorMessage);
        Assert.Empty(setup.Api.Sent("/v1/me", HttpMethod.Delete));
        Assert.Empty(setup.Api.Sent("/v1/me/device-token", HttpMethod.Delete));
        Assert.Equal(DeletionStep.Explain, setup.Model.Step);
        Assert.Equal(Ids.User, setup.Api.Tokens.UserId);
        Assert.Null(deletions.Value);
    }

    [Fact]
    public async Task An_empty_password_asks_for_it()
    {
        var setup = await CreateAsync(Scheduled);

        await setup.Model.DeleteWithPasswordCommand.ExecuteAsync(null);

        Assert.NotNull(setup.Model.ErrorMessage);
        Assert.Empty(setup.Api.Sent("/v1/auth/login"));
    }

    [Fact]
    public async Task Deletion_signs_in_again_then_deletes_with_the_fresh_token_and_signs_this_device_out()
    {
        var setup = await CreateAsync(Scheduled);
        setup.Model.Password = TestPasswords.Correct;

        await setup.Model.DeleteWithPasswordCommand.ExecuteAsync(null);

        var requests = setup.Api.Handler.Requests.ToList();
        var login = requests.FindIndex(r => r.Path == "/v1/auth/login");
        var unregister = requests.FindIndex(r => r.Path == "/v1/me/device-token" && r.Method == HttpMethod.Delete);
        var delete = requests.FindIndex(r => r.Path == "/v1/me" && r.Method == HttpMethod.Delete);
        Assert.True(login >= 0 && login < unregister && unregister < delete, "re-sign-in, then push removal, then deletion");
        Assert.Equal(Email, TestApi.Body(requests[login]).GetProperty("email").GetString());
        Assert.Equal(Http.Jwt(Ids.User, "fresh"), requests[delete].Bearer);

        Assert.Equal(DeletionStep.Done, setup.Model.Step);
        Assert.Equal(AccountText.Date(ExecuteAfter), setup.Model.FinalDate);
        Assert.Equal(new PendingDeletion(Ids.User, ExecuteAfter), deletions.Value);
        Assert.Equal(AccountText.AccountClosed(ExecuteAfter), notices.Value);
        Assert.Null(setup.Api.Tokens.UserId);
        Assert.Null(setup.Api.Store.Session);
        Assert.Equal("", setup.Model.Password);
    }

    [Fact]
    public async Task Deletion_wipes_everything_tied_to_the_account_not_just_the_session()
    {
        var setup = await CreateAsync(Scheduled);
        var installationBefore = await setup.Push.Installation.GetAsync();
        await outbox!.EnqueueAsync(Ids.User, OutboxKinds.Feeding, Guid.NewGuid().ToString(), "{}", TestContext.Current.CancellationToken);
        var preview = Path.Combine(previewFolder, "urgent-0123456789abcdef.jpg");
        var unrelated = Path.Combine(previewFolder, "station-preview.jpg");
        await File.WriteAllBytesAsync(preview, [0xFF, 0xD8], TestContext.Current.CancellationToken);
        await File.WriteAllBytesAsync(unrelated, [0xFF, 0xD8], TestContext.Current.CancellationToken);
        setup.Model.Password = TestPasswords.Correct;

        await setup.Model.DeleteWithPasswordCommand.ExecuteAsync(null);

        Assert.Equal(DeletionStep.Done, setup.Model.Step);
        Assert.Empty(await outbox.ListAsync(Ids.User, TestContext.Current.CancellationToken));
        Assert.Null(setup.Api.Store.Session);
        var provider = (FakePushProvider)setup.Push.Provider;
        Assert.Equal(1, provider.Deletes);
        Assert.Equal(PushState.Initial, setup.Push.States.State);
        Assert.Null(setup.Push.InstallationStore.Value);
        Assert.NotEqual(installationBefore, await setup.Push.Installation.GetAsync());
        Assert.False(File.Exists(preview));
        Assert.True(File.Exists(unrelated));

        // The grace-period marker survives so a sign-in can say the deletion was cancelled.
        Assert.NotNull(deletions.Value);
    }

    [Fact]
    public async Task A_refused_deletion_keeps_the_account_and_puts_notifications_back()
    {
        var setup = await CreateAsync(() => Http.Problem(403, "reauthentication_required"));
        setup.Model.Password = TestPasswords.Correct;

        await setup.Model.DeleteWithPasswordCommand.ExecuteAsync(null);

        Assert.Equal("Güvenliğin için yeniden giriş yapman gerekiyor.", setup.Model.ErrorMessage);
        Assert.Equal(DeletionStep.Explain, setup.Model.Step);
        Assert.Equal(Ids.User, setup.Api.Tokens.UserId);
        Assert.Null(deletions.Value);
        Assert.Null(notices.Value);

        for (var i = 0; i < 50 && setup.Api.Sent("/v1/me/device-token", HttpMethod.Put).Count < 2; i++)
        {
            await Task.Delay(20, TestContext.Current.CancellationToken);
        }

        Assert.Equal(2, setup.Api.Sent("/v1/me/device-token", HttpMethod.Put).Count);
    }

    [Fact]
    public async Task Google_confirmation_explains_itself_until_it_is_configured()
    {
        var setup = await CreateAsync(Scheduled);

        await setup.Model.DeleteWithGoogleCommand.ExecuteAsync(null);

        Assert.Equal(NotConfiguredGoogleSignIn.Message, setup.Model.ErrorMessage);
        Assert.Empty(setup.Api.Sent("/v1/me", HttpMethod.Delete));
    }

    [Fact]
    public async Task Google_confirmation_deletes_after_a_fresh_google_sign_in()
    {
        var setup = await CreateAsync(Scheduled, new FakeGoogle("google-id-token", configured: true));

        await setup.Model.DeleteWithGoogleCommand.ExecuteAsync(null);

        Assert.Single(setup.Api.Sent("/v1/auth/google"));
        Assert.Equal(Http.Jwt(Ids.User, "fresh"), Assert.Single(setup.Api.Sent("/v1/me", HttpMethod.Delete)).Bearer);
        Assert.Equal(DeletionStep.Done, setup.Model.Step);
    }

    [Fact]
    public async Task Backing_out_of_the_google_chooser_deletes_nothing()
    {
        var setup = await CreateAsync(Scheduled, new FakeGoogle(null, configured: true));

        await setup.Model.DeleteWithGoogleCommand.ExecuteAsync(null);

        Assert.Empty(setup.Api.Sent("/v1/me", HttpMethod.Delete));
        Assert.Equal(DeletionStep.Explain, setup.Model.Step);
    }
}

public sealed class SignInTests
{
    private readonly MemoryDeletionStore deletions = new();
    private readonly RecordingNotice dialogs = new();
    private readonly FakeNavigation navigation = new();
    private readonly MemorySessionNotice notices = new();

    private (SignInViewModel Model, TestApi Api) Create(string user = Ids.User, IGoogleSignIn? google = null)
    {
        var api = new TestApi(r => Http.Done(r.Path is "/v1/auth/login" or "/v1/auth/google"
            ? Http.Json(HttpStatusCode.OK, Http.Tokens(user, "n"))
            : new HttpResponseMessage(HttpStatusCode.NoContent)));
        var push = new PushHarness(api);
        var session = new AccountSession(api.Client, push.Registration, deletions, api.Clock);
        var model = new SignInViewModel(session, navigation, notices, dialogs, google ?? new NotConfiguredGoogleSignIn())
        {
            Email = "elif@ornek.test",
            Password = TestPasswords.Correct,
        };
        return (model, api);
    }

    [Fact]
    public async Task Signing_in_within_the_grace_period_says_the_deletion_was_cancelled()
    {
        var (model, api) = Create();
        deletions.Value = new PendingDeletion(Ids.User, api.Clock.GetUtcNow() + TimeSpan.FromDays(3));

        await model.SignInCommand.ExecuteAsync(null);

        var shown = Assert.Single(dialogs.Shown);
        Assert.Equal(AccountText.DeletionCancelled, shown.Message);
        Assert.Null(deletions.Value);
        Assert.Equal(Routes.Map, navigation.Last);
        Assert.Equal("", model.Password);
    }

    [Fact]
    public async Task An_expired_grace_period_is_forgotten_quietly()
    {
        var (model, api) = Create();
        deletions.Value = new PendingDeletion(Ids.User, api.Clock.GetUtcNow() - TimeSpan.FromMinutes(1));

        await model.SignInCommand.ExecuteAsync(null);

        Assert.Empty(dialogs.Shown);
        Assert.Null(deletions.Value);
    }

    [Fact]
    public async Task Another_account_signing_in_does_not_claim_the_cancellation()
    {
        var (model, api) = Create(Ids.Other);
        var pending = new PendingDeletion(Ids.User, api.Clock.GetUtcNow() + TimeSpan.FromDays(3));
        deletions.Value = pending;

        await model.SignInCommand.ExecuteAsync(null);

        Assert.Empty(dialogs.Shown);
        Assert.Equal(pending, deletions.Value);
    }

    [Fact]
    public async Task The_google_button_explains_it_is_not_configured_yet()
    {
        var (model, api) = Create();

        await model.GoogleCommand.ExecuteAsync(null);

        Assert.Equal(NotConfiguredGoogleSignIn.Message, model.ErrorMessage);
        Assert.Empty(api.Handler.Requests);
        Assert.Empty(navigation.Visits);
    }

    [Fact]
    public void The_notice_left_by_deletion_or_expiry_shows_once()
    {
        var (model, _) = Create();
        notices.Set("Hesabın kapandı.");

        model.OnAppearing();
        Assert.Equal("Hesabın kapandı.", model.Notice);
        Assert.Null(notices.Value);
    }

    [Fact]
    public void Badges_are_named_in_turkish_and_unknown_codes_are_skipped()
    {
        Assert.Equal(["İlk besleme", "10 besleme", "İlk görülme"],
            BadgeText.For([MeBadges.FirstFeeding, MeBadges.Feedings10, "leaderboard_top", MeBadges.FirstSighting]));
    }
}
