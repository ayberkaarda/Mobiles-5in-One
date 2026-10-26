using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Serilog.Core;
using Serilog.Events;
using Xunit;

namespace Patika.Web.Tests;

public sealed class WebHostHardeningTests
{
    [Fact]
    public void WebLogsGoThroughTheMaskingPipeline()
    {
        var capture = new CaptureSink();
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:PatikaRead", "Host=localhost;Port=1;Database=unused");
            builder.ConfigureTestServices(services => services.AddSingleton<ILogEventSink>(capture));
        });

        var logger = factory.Services.GetRequiredService<ILogger<WebHostHardeningTests>>();
        logger.LogWarning("Admin sign-in for {Email} with {AccessToken} and {Detail}", "pamuk.sever@kedimahallesi.example",
            "plain-token-value", "Bearer eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl");

        var line = Assert.Single(capture.Events, e => e.MessageTemplate.Text.StartsWith("Admin sign-in", StringComparison.Ordinal)).RenderMessage();
        Assert.DoesNotContain("pamuk.sever", line, StringComparison.Ordinal);
        Assert.DoesNotContain("plain-token-value", line, StringComparison.Ordinal);
        Assert.DoesNotContain("eyJ", line, StringComparison.Ordinal);
        Assert.Contains("p***@k***", line, StringComparison.Ordinal);
    }

    [Fact]
    public void ProductionRefusesToStartWithoutAPersistentKeyRing()
    {
        using var factory = Production(keysPath: null);
        var error = Assert.ThrowsAny<Exception>(() => factory.Services);
        Assert.Contains("DataProtection:KeysPath", error.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public void TheKeyRingIsPersistedSoAdminCookiesSurviveARestart()
    {
        var keys = Path.Combine(Path.GetTempPath(), "patika-web-keys-" + Guid.NewGuid().ToString("N"));
        try
        {
            string protectedText;
            using (var first = Production(keys))
            {
                protectedText = first.Services.GetRequiredService<IDataProtectionProvider>().CreateProtector("test").Protect("admin-session");
            }

            Assert.NotEmpty(Directory.GetFiles(keys, "key-*.xml"));
            using var second = Production(keys);
            Assert.Equal("admin-session", second.Services.GetRequiredService<IDataProtectionProvider>().CreateProtector("test").Unprotect(protectedText));
        }
        finally
        {
            if (Directory.Exists(keys)) Directory.Delete(keys, recursive: true);
        }
    }

    private static WebApplicationFactory<Program> Production(string? keysPath) => new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
    {
        builder.UseEnvironment("Production");
        builder.UseSetting("ConnectionStrings:PatikaRead", "Host=localhost;Port=1;Database=unused");
        builder.UseSetting("Web:PublicBaseUrl", "https://patika.test");
        if (keysPath is not null) builder.UseSetting("DataProtection:KeysPath", keysPath);
    });

    private sealed class CaptureSink : ILogEventSink
    {
        private readonly Lock gate = new();
        private readonly List<LogEvent> events = [];

        public IReadOnlyList<LogEvent> Events
        {
            get
            {
                lock (gate) return [.. events];
            }
        }

        public void Emit(LogEvent logEvent)
        {
            lock (gate) events.Add(logEvent);
        }
    }
}
