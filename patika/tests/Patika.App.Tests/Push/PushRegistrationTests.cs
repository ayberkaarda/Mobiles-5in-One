using System.Net;
using Patika.App.Core.Push;
using Patika.App.Tests.Account;
using Xunit;

namespace Patika.App.Tests.Push;

public sealed class InstallationIdTests
{
    [Fact]
    public async Task The_installation_id_is_created_once_and_stays_the_same_across_restarts()
    {
        var store = new MemoryInstallationStore();

        var first = await new InstallationId(store).GetAsync();
        var sameRun = await new InstallationId(store).GetAsync();

        // A "restart": a new instance reading the same durable slot.
        var restarted = new InstallationId(store);
        var afterRestart = await restarted.GetAsync();
        var again = await restarted.GetAsync();

        Assert.NotEqual(Guid.Empty, first);
        Assert.Equal(first, sameRun);
        Assert.Equal(first, afterRestart);
        Assert.Equal(first, again);
        Assert.Equal(1, store.Writes);
        Assert.Equal(first.ToString("D"), store.Value);
    }

    [Theory]
    [InlineData("not-a-guid")]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    [InlineData("")]
    public async Task A_lost_or_unreadable_slot_gets_a_new_id_that_is_then_kept(string stored)
    {
        var store = new MemoryInstallationStore { Value = stored };

        var id = await new InstallationId(store).GetAsync();

        Assert.NotEqual(Guid.Empty, id);
        Assert.Equal(id, await new InstallationId(store).GetAsync());
        Assert.Equal(1, store.Writes);
    }

    [Fact]
    public async Task Concurrent_first_reads_create_one_id()
    {
        var store = new MemoryInstallationStore();
        var installation = new InstallationId(store);

        var ids = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => installation.GetAsync()));

        Assert.Single(ids.Distinct());
        Assert.Equal(1, store.Writes);
    }
}

public sealed class PushRegistrationTests
{
    private static TestApi Api() => new(r => Http.Done(r.Path == "/v1/auth/refresh"
        ? Http.Json(HttpStatusCode.OK, Http.Tokens(Ids.User, "r"))
        : new HttpResponseMessage(HttpStatusCode.NoContent)));

    [Fact]
    public async Task Without_a_push_configuration_nothing_is_registered()
    {
        var api = Api();
        await api.SignInAsync();
        var harness = new PushHarness(api, new NoPushTokenProvider());

        var status = await harness.Registration.SyncAsync(TestContext.Current.CancellationToken);

        Assert.Equal(PushStatus.NotConfigured, status);
        Assert.False(harness.Registration.IsConfigured);
        Assert.Empty(api.Sent("/v1/me/device-token"));
    }

    [Fact]
    public async Task A_signed_in_device_registers_its_token_with_the_stable_installation_id()
    {
        var api = Api();
        await api.SignInAsync();
        var harness = new PushHarness(api);

        var status = await harness.Registration.SyncAsync(TestContext.Current.CancellationToken);
        await harness.Registration.SyncAsync(TestContext.Current.CancellationToken);

        Assert.Equal(PushStatus.Registered, status);
        var puts = api.Sent("/v1/me/device-token", HttpMethod.Put);
        Assert.Equal(2, puts.Count);
        var body = TestApi.Body(puts[0]);
        Assert.Equal(Ids.PushToken, body.GetProperty("token").GetString());
        var installation = body.GetProperty("installationId").GetString();
        Assert.Equal(harness.InstallationStore.Value, installation);
        Assert.Equal(installation, TestApi.Body(puts[1]).GetProperty("installationId").GetString());
        Assert.Equal(Ids.PushToken, harness.States.State.Token);
        Assert.Equal(Ids.User, harness.States.State.UserId);
    }

    [Fact]
    public async Task Signed_out_devices_register_nothing()
    {
        var api = Api();
        var harness = new PushHarness(api);

        Assert.Equal(PushStatus.SignedOut, await harness.Registration.SyncAsync(TestContext.Current.CancellationToken));
        Assert.Empty(api.Handler.Requests);
    }

    [Fact]
    public async Task Sign_in_and_a_rotated_token_both_register_after_attach()
    {
        var api = Api();
        var provider = new FakePushProvider();
        var harness = new PushHarness(api, provider);
        var registered = new SemaphoreSlim(0);
        harness.Registration.StatusChanged += (_, _) =>
        {
            if (harness.Registration.Status == PushStatus.Registered)
            {
                registered.Release();
            }
        };
        harness.Registration.Attach();
        harness.Registration.Attach();

        await api.SignInAsync();
        Assert.True(await registered.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken));

        provider.Rotate("fcm-token-rotated-0123456789abcdefghijklmnopqrstuv");
        Assert.True(await registered.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken));

        var puts = api.Sent("/v1/me/device-token", HttpMethod.Put);
        Assert.Equal(2, puts.Count);
        Assert.Equal("fcm-token-rotated-0123456789abcdefghijklmnopqrstuv", TestApi.Body(puts[1]).GetProperty("token").GetString());
    }

    [Fact]
    public async Task Turning_push_off_removes_the_registered_token_and_turning_it_on_asks_permission()
    {
        var api = Api();
        await api.SignInAsync();
        var harness = new PushHarness(api, permission: false);
        await harness.Registration.SyncAsync(TestContext.Current.CancellationToken);

        Assert.Equal(PushStatus.Off, await harness.Registration.SetEnabledAsync(false, TestContext.Current.CancellationToken));
        var delete = Assert.Single(api.Sent("/v1/me/device-token", HttpMethod.Delete));
        Assert.Equal(Ids.PushToken, TestApi.Body(delete).GetProperty("token").GetString());
        Assert.Null(harness.States.State.Token);
        Assert.False(harness.States.State.Enabled);

        // Permission refused: stays off, nothing registered.
        Assert.Equal(PushStatus.Off, await harness.Registration.SetEnabledAsync(true, TestContext.Current.CancellationToken));
        Assert.Equal(PushMessages.PermissionDenied, harness.Registration.LastError);
        Assert.Single(api.Sent("/v1/me/device-token", HttpMethod.Put));

        harness.Permission.Granted = true;
        Assert.Equal(PushStatus.Registered, await harness.Registration.SetEnabledAsync(true, TestContext.Current.CancellationToken));
        Assert.Equal(2, api.Sent("/v1/me/device-token", HttpMethod.Put).Count);
    }

    [Fact]
    public async Task Resume_re_registers_only_when_the_last_success_is_old()
    {
        var api = Api();
        await api.SignInAsync();
        var harness = new PushHarness(api);
        await harness.Registration.SyncAsync(TestContext.Current.CancellationToken);

        api.Clock.Advance(TimeSpan.FromHours(2));
        await harness.Registration.SyncIfDueAsync(TestContext.Current.CancellationToken);
        Assert.Single(api.Sent("/v1/me/device-token", HttpMethod.Put));

        api.Clock.Advance(PushRegistration.ResyncInterval);
        await harness.Registration.SyncIfDueAsync(TestContext.Current.CancellationToken);
        Assert.Equal(2, api.Sent("/v1/me/device-token", HttpMethod.Put).Count);
    }

    [Fact]
    public async Task A_token_owned_by_another_installation_is_reported_not_thrown()
    {
        var api = new TestApi(r => Http.Done(Http.Problem(409, "device_token_in_use")));
        await api.SignInAsync();
        var harness = new PushHarness(api);

        Assert.Equal(PushStatus.Failed, await harness.Registration.SyncAsync(TestContext.Current.CancellationToken));
        Assert.Equal("Bu cihaz başka bir hesapla kayıtlı.", harness.Registration.LastError);
    }
}

public sealed class PushSessionRaceTests
{
    private static TestApi Api() => new(_ => Http.Done(new HttpResponseMessage(HttpStatusCode.NoContent)));

    [Fact]
    public async Task A_registration_started_for_one_account_is_never_sent_with_the_next_account_token()
    {
        var api = Api();
        await api.SignInAsync(Ids.User, "a");
        var provider = new FakePushProvider { Barrier = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously) };
        var harness = new PushHarness(api, provider);

        var pending = harness.Registration.SyncAsync(TestContext.Current.CancellationToken);
        await provider.Reached.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);

        // Account switch while the registration for A waits for its token.
        await api.SignInAsync(Ids.Other, "b");
        provider.Barrier.SetResult();
        var status = await pending;

        Assert.Equal(PushStatus.SignedOut, status);
        Assert.Empty(api.Sent("/v1/me/device-token"));
        Assert.Null(harness.States.State.Token);
        Assert.Null(harness.States.State.UserId);
    }

    [Fact]
    public async Task A_late_answer_for_an_ended_session_does_not_write_its_state()
    {
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var sent = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var api = new TestApi(async r =>
        {
            if (r.Path == "/v1/me/device-token")
            {
                sent.TrySetResult();
                await release.Task;
            }

            return new HttpResponseMessage(HttpStatusCode.NoContent);
        });
        await api.SignInAsync(Ids.User, "a");
        var harness = new PushHarness(api);

        var pending = harness.Registration.SyncAsync(TestContext.Current.CancellationToken);
        await sent.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        await api.SignInAsync(Ids.Other, "b");
        release.SetResult();

        Assert.Equal(PushStatus.SignedOut, await pending);
        Assert.Equal(Http.Jwt(Ids.User, "a"), Assert.Single(api.Sent("/v1/me/device-token")).Bearer);
        Assert.Null(harness.States.State.UserId);
    }

    [Fact]
    public async Task A_token_rotation_during_sign_out_cannot_register_the_old_account_again()
    {
        var api = Api();
        var provider = new FakePushProvider();
        var harness = new PushHarness(api, provider);
        harness.Registration.Attach();
        await api.SignInAsync(Ids.User, "a");
        await harness.Registration.SyncAsync(TestContext.Current.CancellationToken);
        var putsBefore = api.Sent("/v1/me/device-token", HttpMethod.Put).Count;

        await harness.Registration.UnregisterAsync(TestContext.Current.CancellationToken);

        // FCM rotates the token before the local sign-out has wiped the session.
        provider.Rotate("fcm-token-rotated-0123456789abcdefghijklmnopqrstuv");
        var status = await harness.Registration.SyncAsync(TestContext.Current.CancellationToken);

        Assert.Equal(PushStatus.SignedOut, status);
        Assert.True(harness.Registration.IsPaused);
        Assert.Equal(putsBefore, api.Sent("/v1/me/device-token", HttpMethod.Put).Count);
        Assert.Single(api.Sent("/v1/me/device-token", HttpMethod.Delete));
        Assert.Null(harness.States.State.Token);

        // The next sign-in ends the pause.
        await api.SignInAsync(Ids.Other, "b");
        for (var i = 0; i < 100 && api.Sent("/v1/me/device-token", HttpMethod.Put).Count == putsBefore; i++)
        {
            await Task.Delay(10, TestContext.Current.CancellationToken);
        }

        Assert.False(harness.Registration.IsPaused);
        Assert.Equal(Http.Jwt(Ids.Other, "b"), api.Sent("/v1/me/device-token", HttpMethod.Put)[^1].Bearer);
    }

    [Fact]
    public async Task Unregister_never_removes_a_token_with_another_account_session()
    {
        var api = Api();
        await api.SignInAsync(Ids.User, "a");
        var harness = new PushHarness(api);
        await harness.Registration.SyncAsync(TestContext.Current.CancellationToken);
        await api.SignInAsync(Ids.Other, "b");

        await harness.Registration.UnregisterAsync(TestContext.Current.CancellationToken);

        Assert.Empty(api.Sent("/v1/me/device-token", HttpMethod.Delete));
        Assert.Null(harness.States.State.Token);
    }

    [Fact]
    public async Task Forgetting_the_device_deletes_the_push_token_and_the_installation_id()
    {
        var api = Api();
        await api.SignInAsync();
        var provider = new FakePushProvider();
        var harness = new PushHarness(api, provider);
        await harness.Registration.SyncAsync(TestContext.Current.CancellationToken);
        var before = await harness.Installation.GetAsync();

        await harness.Registration.ForgetDeviceAsync(TestContext.Current.CancellationToken);

        Assert.Equal(1, provider.Deletes);
        Assert.Equal(PushState.Initial, harness.States.State);
        Assert.Null(harness.InstallationStore.Value);
        Assert.NotEqual(before, await harness.Installation.GetAsync());
    }
}

public sealed class NotificationTargetTests
{
    [Theory]
    [InlineData("urgent_nearby")]
    [InlineData("urgent")]
    public void Allowlisted_types_get_fixed_text_and_the_payload_text_is_ignored(string type)
    {
        var content = NotificationContent.From(new Dictionary<string, string>
        {
            ["type"] = type,
            ["urgentId"] = Post.ToString("D"),
            ["title"] = "Elif, Moda Parkı 3. bank",
            ["body"] = "+90 555 000 00 00",
        });

        Assert.NotNull(content);
        Assert.Equal("Yakınında acil yardım çağrısı var", content.Title);
        Assert.Equal(NotificationContent.UrgentBody, content.Body);
        Assert.Equal(new NotificationTarget("urgent", Post), content.Target);
    }

    [Theory]
    [InlineData("adoption_update")]
    [InlineData("Urgent")]
    [InlineData("")]
    public void Unknown_types_show_nothing(string type) =>
        Assert.Null(NotificationContent.From(new Dictionary<string, string> { ["type"] = type, ["urgentId"] = Post.ToString("D") }));

    [Fact]
    public void Only_a_canonical_guid_leads_to_a_post() =>
        Assert.Null(NotificationTarget.From(new Dictionary<string, string> { ["type"] = "urgent", ["urgentId"] = Post.ToString("D").ToUpperInvariant() }));

    private static readonly Guid Post = Guid.Parse("8d3a9b52-6a7e-4b1f-9c51-0e7c2f1a9d44");

    [Fact]
    public void An_urgent_payload_leads_to_the_post_once()
    {
        var target = NotificationTarget.From(new Dictionary<string, string>
        {
            ["type"] = "urgent",
            ["urgentId"] = Post.ToString("D"),
            ["category"] = "Injured",
        });
        var inbox = new NotificationInbox();

        inbox.Offer(target);

        Assert.True(inbox.HasPending);
        Assert.Equal(new NotificationTarget("urgent", Post), inbox.Take());
        Assert.Null(inbox.Take());
    }

    [Theory]
    [InlineData("adoption", "8d3a9b52-6a7e-4b1f-9c51-0e7c2f1a9d44")]
    [InlineData("urgent", "not-a-guid")]
    [InlineData("urgent", "00000000-0000-0000-0000-000000000000")]
    [InlineData(null, "8d3a9b52-6a7e-4b1f-9c51-0e7c2f1a9d44")]
    public void Anything_else_opens_the_app_normally(string? type, string id)
    {
        var data = new Dictionary<string, string> { ["urgentId"] = id };
        if (type is not null)
        {
            data["type"] = type;
        }

        var inbox = new NotificationInbox();
        inbox.Offer(NotificationTarget.From(data));

        Assert.False(inbox.HasPending);
    }
}
