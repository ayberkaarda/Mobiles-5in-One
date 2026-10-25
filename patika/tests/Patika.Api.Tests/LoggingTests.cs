using System.Net;
using System.Net.Http.Json;
using Patika.Api.Logging;
using Patika.Api.Tests.Infrastructure;
using Patika.Contracts.Auth;
using Serilog.Events;
using Serilog.Parsing;
using Xunit;
using static Patika.Api.Tests.Infrastructure.ApiTestClient;

namespace Patika.Api.Tests;

public sealed class LoggingTests
{
    [Fact]
    public async Task RegisterVerifyLoginRefreshLogSampleContainsNoEmailPasswordOrToken()
    {
        await using var factory = new PatikaApiFactory();
        using var client = factory.CreateApiClient();
        const string email = "pamuk.sever@kedimahallesi.example";
        const string password = "sokak-kedisi-sevgisi-9";

        var registered = await client.RegisterAsync(factory, email, password);
        using var login = await client.LoginAsync(email, password);
        var loggedIn = (await login.Content.ReadFromJsonAsync<TokenResponse>(Ct))!;
        using var failed = await client.LoginAsync(email, "yanlis-sifre-123");
        using var refreshed = await client.RefreshAsync(loggedIn.RefreshToken);
        using var reused = await client.RefreshAsync(loggedIn.RefreshToken);
        using var me = await client.GetMeAsync(registered.AccessToken);
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, reused.StatusCode);

        var lines = factory.Logs.RenderAll();
        var sample = string.Join('\n', lines);

        Assert.NotEmpty(lines);
        Assert.Contains("p***@k***", sample, StringComparison.Ordinal); // the handler logged the address, masked
        foreach (var secret in new[]
        {
            email, "pamuk.sever", "kedimahallesi", password, "yanlis-sifre-123",
            registered.AccessToken, registered.RefreshToken, loggedIn.AccessToken, loggedIn.RefreshToken,
            registered.AccessToken[..20],
        })
        {
            Assert.DoesNotContain(secret, sample, StringComparison.OrdinalIgnoreCase);
        }

        // Six digits can occur inside timestamps; the code must never appear as a number of its own.
        var code = factory.Outbox.VerificationCodeFor(email);
        Assert.DoesNotMatch($"(?<![0-9]){code}(?![0-9])", sample);

        Assert.DoesNotContain("Bearer ", sample, StringComparison.Ordinal);
    }

    [Fact]
    public async Task RequestLinesCarryARequestIdAndNoQueryString()
    {
        await using var factory = new PatikaApiFactory();
        using var client = factory.CreateApiClient();

        using var response = await client.GetAsync("/v1/health?email=pamuk@example.org", Ct);

        var requestEvents = factory.Logs.Events
            .Where(e => e.MessageTemplate.Text.StartsWith("HTTP ", StringComparison.Ordinal))
            .ToArray();
        var line = Assert.Single(requestEvents);
        Assert.True(line.Properties.ContainsKey("RequestId"));
        Assert.NotNull(line.TraceId);
        Assert.DoesNotContain("pamuk", LogCollector.Render(line), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void EnricherMasksEmailsTokensAndCoordinates()
    {
        var logEvent = new LogEvent(DateTimeOffset.UtcNow, LogEventLevel.Information, null,
            new MessageTemplateParser().Parse("{Email} {Note} {RefreshToken} {Authorization} {Lat} {Lng} {Payload}"),
            [
                new LogEventProperty("Email", new ScalarValue("tekir@example.org")),
                new LogEventProperty("Note", new ScalarValue("seen at 40.987654, 29.031234 by mia@example.com eyJhbGciOi.eyJzdWIiOi.c2ln")),
                new LogEventProperty("RefreshToken", new ScalarValue("opaque-refresh-value")),
                new LogEventProperty("Authorization", new ScalarValue("Bearer abc")),
                new LogEventProperty("Lat", new ScalarValue(40.987654)),
                new LogEventProperty("Lng", new ScalarValue(29.031234)),
                new LogEventProperty("Payload", new StructureValue(
                [
                    new LogEventProperty("Password", new ScalarValue("hunter22-hunter")),
                    new LogEventProperty("Contact", new ScalarValue("veteriner@example.net")),
                ])),
            ]);

        new MaskingEnricher().Enrich(logEvent, null!);
        var rendered = LogCollector.Render(logEvent);

        Assert.Equal("t***@e***", ((ScalarValue)logEvent.Properties["Email"]).Value);
        Assert.Equal(MaskingEnricher.Redacted, ((ScalarValue)logEvent.Properties["RefreshToken"]).Value);
        Assert.Equal(MaskingEnricher.Redacted, ((ScalarValue)logEvent.Properties["Authorization"]).Value);
        Assert.Equal(40.988, ((ScalarValue)logEvent.Properties["Lat"]).Value);
        Assert.Equal(29.031, ((ScalarValue)logEvent.Properties["Lng"]).Value);
        Assert.Contains("40.988, 29.031", rendered, StringComparison.Ordinal);
        foreach (var secret in new[] { "tekir@", "mia@", "veteriner@", "hunter22", "opaque-refresh", "Bearer abc", "eyJhbGciOi", "40.987654" })
        {
            Assert.DoesNotContain(secret, rendered, StringComparison.Ordinal);
        }
    }
}
