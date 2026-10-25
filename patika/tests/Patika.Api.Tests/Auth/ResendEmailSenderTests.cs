using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Patika.Api.Email;
using Patika.Api.Security.Tokens;
using Xunit;

namespace Patika.Api.Tests.Auth;

/// <summary>The Resend sender against an in-process HTTP handler; nothing reaches the network.</summary>
public sealed class ResendEmailSenderTests
{
    private const string ApiKey = "re_unit_key_0123456789";
    private const string To = "kedi.dostu@example.org";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task PostsTheExpectedPayloadToResend()
    {
        var handler = new RecordingHandler(HttpStatusCode.OK);
        var logs = new ListLogger();
        var sender = CreateSender(handler, logs);
        var code = RefreshTokens.NewToken();

        await sender.SendAsync(AuthEmails.PasswordReset(To, code), Ct);

        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal(new Uri("https://api.resend.com/emails"), request.Uri);
        Assert.Equal($"Bearer {ApiKey}", request.Authorization);
        Assert.Equal("application/json", request.ContentType);
        Assert.False(string.IsNullOrWhiteSpace(request.IdempotencyKey));

        using var json = JsonDocument.Parse(request.Body);
        var root = json.RootElement;
        Assert.Equal("Patika <bildirim@patika.app>", root.GetProperty("from").GetString());
        Assert.Equal([To], root.GetProperty("to").EnumerateArray().Select(e => e.GetString()));
        Assert.Equal("Patika: şifre sıfırlama kodu", root.GetProperty("subject").GetString());
        Assert.Contains(code, root.GetProperty("text").GetString(), StringComparison.Ordinal);
        Assert.False(root.TryGetProperty("reply_to", out _));
        var tag = Assert.Single(root.GetProperty("tags").EnumerateArray());
        Assert.Equal("kind", tag.GetProperty("name").GetString());
        Assert.Equal("password_reset", tag.GetProperty("value").GetString());
        Assert.Equal(["from", "subject", "tags", "text", "to"],
            root.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));

        AssertNothingSensitive(logs, code);
        Assert.Contains(logs.Lines, line => line.Contains("PasswordReset", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(HttpStatusCode.UnprocessableEntity)]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.InternalServerError)]
    public async Task RejectionsAreLoggedWithoutAddressOrCodeAndNotThrown(HttpStatusCode status)
    {
        var handler = new RecordingHandler(status, echo: true);
        var logs = new ListLogger();
        var sender = CreateSender(handler, logs);
        var code = RefreshTokens.NewToken();

        await sender.SendAsync(AuthEmails.Verification(To, code), Ct);

        Assert.Single(handler.Requests);
        Assert.Contains(logs.Lines, line => line.Contains(((int)status).ToString(System.Globalization.CultureInfo.InvariantCulture),
            StringComparison.Ordinal));
        AssertNothingSensitive(logs, code);
    }

    [Fact]
    public async Task TransportFailuresAreLoggedWithoutDetails()
    {
        var handler = new RecordingHandler(HttpStatusCode.OK) { Failure = new HttpRequestException($"connect failed for {To}") };
        var logs = new ListLogger();
        var sender = CreateSender(handler, logs);
        var code = RefreshTokens.NewToken();

        await sender.SendAsync(AuthEmails.PasswordReset(To, code), Ct);

        Assert.Contains(logs.Lines, line => line.Contains(nameof(HttpRequestException), StringComparison.Ordinal));
        AssertNothingSensitive(logs, code);
    }

    [Fact]
    public async Task WithoutAnApiKeyNothingIsSent()
    {
        var handler = new RecordingHandler(HttpStatusCode.OK);
        var logs = new ListLogger();
        var sender = new ResendEmailSender(new SingleClientFactory(handler),
            Options.Create(new ResendSettings()), logs.For<ResendEmailSender>());

        await sender.SendAsync(AuthEmails.Verification(To, RefreshTokens.NewToken()), Ct);

        Assert.Empty(handler.Requests);
        AssertNothingSensitive(logs, To);
    }

    [Fact]
    public void ResendIsChosenOutsideDevelopmentOnlyWhenTheKeyIsSet()
    {
        Assert.IsType<ResendEmailSender>(Resolve("Production", ApiKey));
        Assert.IsType<UnconfiguredEmailSender>(Resolve("Production", null));
        Assert.IsType<DevelopmentFolderEmailSender>(Resolve("Development", ApiKey));
    }

    [Fact]
    public void EveryKindHasATurkishTemplateWithItsOwnTag()
    {
        var at = new DateTimeOffset(2026, 11, 1, 9, 0, 0, TimeSpan.Zero);
        var messages = new[]
        {
            AuthEmails.Verification(To, "x"),
            AuthEmails.RegistrationAttempt(To),
            AuthEmails.PasswordReset(To, "x"),
            AccountEmails.DeletionScheduled(To, at),
        };

        Assert.Equal(Enum.GetValues<EmailKind>(), messages.Select(m => m.Kind));
        Assert.All(messages, m => Assert.StartsWith("Patika: ", m.Subject, StringComparison.Ordinal));
        Assert.Equal(4, messages.Select(m => ResendEmailSender.TagValue(m.Kind)).Distinct().Count());
        Assert.Contains("1 Kasım 2026 12:00", messages[3].Body, StringComparison.Ordinal);
    }

    private static IEmailSender Resolve(string environment, string? key)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Resend:ApiKey"] = key })
            .Build();
        var services = new ServiceCollection().AddLogging();
        services.AddPatikaEmail(configuration, new FakeEnvironment(environment));
        using var provider = services.BuildServiceProvider();
        return provider.GetRequiredService<IEmailSender>();
    }

    private static ResendEmailSender CreateSender(RecordingHandler handler, ListLogger logs) => new(
        new SingleClientFactory(handler),
        Options.Create(new ResendSettings { ApiKey = ApiKey }),
        logs.For<ResendEmailSender>());

    private static void AssertNothingSensitive(ListLogger logs, string secret)
    {
        var all = string.Join('\n', logs.Lines);
        Assert.DoesNotContain(To, all, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("kedi.dostu", all, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(secret, all, StringComparison.Ordinal);
        Assert.DoesNotContain(ApiKey, all, StringComparison.Ordinal);
        Assert.DoesNotContain("Patika:", all, StringComparison.Ordinal);
    }

    private sealed record RecordedRequest(
        HttpMethod Method, Uri? Uri, string? Authorization, string? ContentType, string? IdempotencyKey, string Body);

    private sealed class RecordingHandler(HttpStatusCode status, bool echo = false) : HttpMessageHandler
    {
        public ConcurrentQueue<RecordedRequest> Requests { get; } = new();

        public Exception? Failure { get; init; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
            Requests.Enqueue(new RecordedRequest(request.Method, request.RequestUri, request.Headers.Authorization?.ToString(),
                request.Content?.Headers.ContentType?.MediaType,
                request.Headers.TryGetValues("Idempotency-Key", out var keys) ? keys.Single() : null, body));
            if (Failure is not null)
            {
                throw Failure;
            }

            // A provider error that echoes the request must not end up in the logs either.
            return new HttpResponseMessage(status) { Content = new StringContent(echo ? body : "{\"id\":\"e-1\"}") };
        }
    }

    private sealed class SingleClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private sealed class FakeEnvironment(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;

        public string ApplicationName { get; set; } = "Patika.Api";

        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;

        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } =
            new Microsoft.Extensions.FileProviders.NullFileProvider();
    }

    /// <summary>Renders every message and every structured value, so nothing hides in properties.</summary>
    private sealed class ListLogger
    {
        private readonly ConcurrentQueue<string> lines = new();

        public IReadOnlyList<string> Lines => [.. lines];

        public ILogger<T> For<T>() => new Logger<T>(this);

        private sealed class Logger<T>(ListLogger sink) : ILogger<T>
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
                Func<TState, Exception?, string> formatter)
            {
                var values = state is IEnumerable<KeyValuePair<string, object?>> pairs
                    ? string.Join(';', pairs.Select(p => $"{p.Key}={p.Value}"))
                    : "";
                sink.lines.Enqueue($"{logLevel}: {formatter(state, exception)} | {values} | {exception}");
            }
        }
    }
}
