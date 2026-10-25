using System.Text.Json;
using Patika.App.Core.Api;
using Patika.App.Core.Location;
using Patika.App.Core.Navigation;
using Patika.App.Core.Push;
using Patika.App.ViewModels.Account;
using Patika.App.ViewModels.Urgent;

namespace Patika.App.Tests.Account;

internal static class Ids
{
    public const string User = "6a0c7d10-0000-4000-8000-0000000000d1";
    public const string Other = "6a0c7d10-0000-4000-8000-0000000000d2";
    public const string PushToken = "fcm-token-0123456789abcdefghijklmnopqrstuvwxyz:APA91b";
}

/// <summary>A client over a fake handler, with the token manager and store to inspect.</summary>
internal sealed class TestApi
{
    public TestApi(Func<RecordedRequest, Task<HttpResponseMessage>> respond, ManualClock? clock = null)
    {
        Clock = clock ?? new ManualClock();
        Handler = new FakeHandler(respond);
        Tokens = new TokenManager(Store, Clock);
        Client = new PatikaApiClient(new HttpClient(Handler), Tokens, new ApiOptions { BaseAddress = new Uri("http://api.test/") });
    }

    public ManualClock Clock { get; }

    public MemoryTokenStore Store { get; } = new();

    public FakeHandler Handler { get; }

    public TokenManager Tokens { get; }

    public PatikaApiClient Client { get; }

    public Task SignInAsync(string userId = Ids.User, string salt = "s1") => Tokens.AcceptAsync(Http.Tokens(userId, salt));

    public IReadOnlyList<RecordedRequest> Sent(string path, HttpMethod? method = null) =>
        [.. Handler.Requests.Where(r => (r.Path == path || r.Path.StartsWith(path + "?", StringComparison.Ordinal))
            && (method is null || r.Method == method))];

    public static JsonElement Body(RecordedRequest request) => JsonDocument.Parse(request.Body ?? "{}").RootElement;
}

internal sealed class FakeNavigation : INavigationService
{
    public List<(string Route, IDictionary<string, object>? Parameters)> Visits { get; } = [];

    public int Backs { get; private set; }

    public string? Last => Visits.Count == 0 ? null : Visits[^1].Route;

    public Task GoToAsync(string route, IDictionary<string, object>? parameters = null)
    {
        Visits.Add((route, parameters));
        return Task.CompletedTask;
    }

    public Task GoBackAsync()
    {
        Backs++;
        return Task.CompletedTask;
    }
}

internal sealed class FakeLocation(LocationAccess access = LocationAccess.Granted, GeoFix? fix = null) : ILocationService
{
    public LocationAccess Access { get; set; } = access;

    public GeoFix? Fix { get; set; } = fix;

    public int Requests { get; private set; }

    public Task<LocationAccess> GetAccessAsync() => Task.FromResult(Access);

    public Task<LocationAccess> RequestAccessAsync(string rationale)
    {
        Requests++;
        return Task.FromResult(Access);
    }

    public Task<GeoFix?> GetCurrentAsync(CancellationToken ct = default) =>
        Task.FromResult(Access == LocationAccess.Granted ? Fix : null);
}

internal sealed class MemorySessionNotice : ISessionNotice
{
    public string? Value { get; set; }

    public string? Take()
    {
        var value = Value;
        Value = null;
        return value;
    }

    public void Set(string message) => Value = message;
}

internal sealed class RecordingNotice : IUserNotice
{
    public List<(string Title, string Message)> Shown { get; } = [];

    public bool Answer { get; set; } = true;

    public Task ShowAsync(string title, string message)
    {
        Shown.Add((title, message));
        return Task.CompletedTask;
    }

    public Task<bool> ConfirmAsync(string title, string message, string accept, string cancel) => Task.FromResult(Answer);
}

internal sealed class FakeGoogle(string? idToken = null, bool configured = false) : IGoogleSignIn
{
    public bool IsConfigured => configured;

    public Task<string?> GetIdTokenAsync(CancellationToken ct = default) => Task.FromResult(idToken);
}

internal sealed class MemoryDeletionStore : IDeletionNoticeStore
{
    public PendingDeletion? Value { get; set; }

    public Task<PendingDeletion?> ReadAsync() => Task.FromResult(Value);

    public Task WriteAsync(PendingDeletion? value)
    {
        Value = value;
        return Task.CompletedTask;
    }
}

internal sealed class MemoryInstallationStore : IInstallationIdStore
{
    public string? Value { get; set; }

    public int Writes { get; private set; }

    public Task<string?> ReadAsync() => Task.FromResult(Value);

    public Task WriteAsync(string value)
    {
        Value = value;
        Writes++;
        return Task.CompletedTask;
    }

    public Task ClearAsync()
    {
        Value = null;
        return Task.CompletedTask;
    }
}

internal sealed class MemoryPushStateStore : IPushStateStore
{
    public PushState State { get; set; } = PushState.Initial;

    public Task<PushState> ReadAsync() => Task.FromResult(State);

    public Task WriteAsync(PushState state)
    {
        State = state;
        return Task.CompletedTask;
    }
}

internal sealed class FakePushProvider(string? token = Ids.PushToken) : IPushTokenProvider
{
    public string? Token { get; set; } = token;

    /// <summary>When set, token reads wait for it (a barrier for race tests).</summary>
    public TaskCompletionSource? Barrier { get; set; }

    /// <summary>Completed when a read reaches the barrier.</summary>
    public TaskCompletionSource Reached { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public int Deletes { get; private set; }

    public bool IsAvailable => true;

    public event EventHandler<string>? TokenChanged;

    public async Task<string?> GetTokenAsync(CancellationToken ct = default)
    {
        if (Barrier is { } barrier)
        {
            Reached.TrySetResult();
            await barrier.Task;
        }

        return Token;
    }

    public Task DeleteTokenAsync(CancellationToken ct = default)
    {
        Deletes++;
        Token = null;
        return Task.CompletedTask;
    }

    public void Rotate(string token)
    {
        Token = token;
        TokenChanged?.Invoke(this, token);
    }
}

internal sealed class FakePermission(bool granted = true) : INotificationPermission
{
    public bool Granted { get; set; } = granted;

    public Task<bool> IsGrantedAsync() => Task.FromResult(Granted);

    public Task<bool> RequestAsync() => Task.FromResult(Granted);
}

internal sealed class FakeLauncher : IAppLauncher
{
    public List<string> Opened { get; } = [];

    public Task<bool> OpenAsync(string uri)
    {
        Opened.Add(uri);
        return Task.FromResult(true);
    }
}

internal sealed class FakePhotos(UrgentPhoto? photo = null) : IUrgentPhotoFlow
{
    public Task<UrgentPhoto?> CaptureAsync(CancellationToken ct = default) =>
        Task.FromResult<UrgentPhoto?>(photo ?? new UrgentPhoto("urgent/0f8fad5b-d9cb-469f-a165-70867728950e", null));
}

/// <summary>Push registration over a test API with in-memory stores.</summary>
internal sealed class PushHarness
{
    public PushHarness(TestApi api, IPushTokenProvider? provider = null, bool permission = true)
    {
        Api = api;
        Provider = provider ?? new FakePushProvider();
        Permission = new FakePermission(permission);
        Installation = new InstallationId(InstallationStore);
        Registration = new PushRegistration(api.Client, Provider, Installation, States, Permission, api.Clock);
    }

    public TestApi Api { get; }

    public IPushTokenProvider Provider { get; }

    public FakePermission Permission { get; }

    public MemoryInstallationStore InstallationStore { get; } = new();

    public MemoryPushStateStore States { get; } = new();

    public InstallationId Installation { get; }

    public PushRegistration Registration { get; }
}
