using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Patika.Api.Email;
using Patika.Worker.Jobs.Ops;
using Patika.Worker.Jobs.Push;
using Serilog.Core;
using Serilog.Events;
using Xunit;

namespace Patika.Worker.Tests;

public sealed class BackupVerifyTests : IDisposable
{
    private static readonly DateTimeOffset Now = new(2026, 10, 26, 12, 0, 0, TimeSpan.Zero);
    private readonly string directory = Path.Combine(Path.GetTempPath(), "patika-backup-test-" + Guid.NewGuid().ToString("N"));

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public BackupVerifyTests() => Directory.CreateDirectory(directory);

    public void Dispose() => Directory.Delete(directory, recursive: true);

    private static string NameAt(DateTimeOffset time) => $"db/patika-{time:yyyyMMdd'T'HHmmss'Z'}.dump.age";

    private static BackupCandidate Good(DateTimeOffset time) => new(NameAt(time), time, 4096, HasChecksum: true);

    [Theory]
    [InlineData(25.5, false)]
    [InlineData(26.5, true)]
    public async Task NewestBackupOlderThanTwentySixHoursAlertsOnce(double hours, bool stale)
    {
        var alerts = new RecordingOpsAlerts();
        var verifier = Verifier(new FakeCatalog([Good(Now.AddHours(-hours))]), alerts);

        var status = await verifier.VerifyAsync(Ct);
        await verifier.VerifyAsync(Ct);

        Assert.True(status.Configured);
        Assert.Equal(stale, status.Stale);
        Assert.Equal(stale ? 1 : 0, alerts.Messages.Count);
        if (stale) Assert.Contains("26.5 h old", alerts.Messages[0].Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task MissingBackupsAndFailedListingsAreStale()
    {
        var empty = await Verifier(new FakeCatalog([]), new RecordingOpsAlerts()).VerifyAsync(Ct);
        Assert.True(empty.Stale);
        Assert.Null(empty.Newest);

        var alerts = new RecordingOpsAlerts();
        var failed = await Verifier(new FakeCatalog([], fail: true), alerts).VerifyAsync(Ct);
        Assert.True(failed.Stale);
        Assert.Contains("listing failed", Assert.Single(alerts.Messages).Subject, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AFarFutureNameCannotKeepAStaleBackupQuiet()
    {
        var alerts = new RecordingOpsAlerts();
        var planted = new BackupCandidate("db/patika-29991231T000000Z.dump.age", Now, 4096, HasChecksum: true);
        var status = await Verifier(new FakeCatalog([Good(Now.AddHours(-30)), planted]), alerts).VerifyAsync(Ct);

        Assert.True(status.Stale);
        Assert.Equal(1, status.IgnoredFuture);
        Assert.Equal(NameAt(Now.AddHours(-30)), status.Newest!.Name);
        Assert.Contains("1 future-dated objects were ignored", Assert.Single(alerts.Messages).Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ClockSkewOfUpToFiveMinutesStillCounts()
    {
        var within = await Verifier(new FakeCatalog([Good(Now.AddMinutes(4))]), new RecordingOpsAlerts()).VerifyAsync(Ct);
        Assert.False(within.Stale);
        Assert.Equal(0, within.IgnoredFuture);

        // A stamp in the past does not help when the store itself dates the object in the future.
        var futureObject = new BackupCandidate(NameAt(Now.AddHours(-1)), Now.AddMinutes(6), 4096, HasChecksum: true);
        var skewed = await Verifier(new FakeCatalog([futureObject]), new RecordingOpsAlerts()).VerifyAsync(Ct);
        Assert.True(skewed.Stale);
        Assert.Equal(1, skewed.IgnoredFuture);
    }

    [Theory]
    [InlineData(0, true)]
    [InlineData(4096, false)]
    public async Task ANewerEmptyOrUnsummedDumpIsReportedAsInvalid(long size, bool hasChecksum)
    {
        var alerts = new RecordingOpsAlerts();
        var older = Good(Now.AddHours(-20));
        var broken = new BackupCandidate(NameAt(Now.AddHours(-1)), Now.AddHours(-1), size, hasChecksum);

        var status = await Verifier(new FakeCatalog([older, broken]), alerts).VerifyAsync(Ct);

        Assert.True(status.Stale);
        Assert.Equal(older.Name, status.Newest!.Name);
        Assert.Equal(broken.Name, status.Invalid!.Name);
        var alert = Assert.Single(alerts.Messages);
        Assert.Contains("backup is invalid", alert.Subject, StringComparison.Ordinal);
        Assert.Contains("empty or has no .sha256 sidecar", alert.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task UnconfiguredCheckIsOffAndSilent()
    {
        var alerts = new RecordingOpsAlerts();
        var verifier = new BackupVerifier(Options.Create(new BackupSettings()), new FakeCatalog([]), new FixedClock(Now),
            alerts, new BackupAlertState(), NullLogger<BackupVerifier>.Instance);
        var status = await verifier.VerifyAsync(Ct);
        Assert.False(status.Configured);
        Assert.Empty(alerts.Messages);
    }

    [Fact]
    public async Task DirectoryCatalogReadsSizesAndSidecarsAndIgnoresOtherFiles()
    {
        await File.WriteAllTextAsync(Path.Combine(directory, "patika-20261025T030000Z.dump.age"), "x", Ct);
        await File.WriteAllTextAsync(Path.Combine(directory, "patika-20261026T030151Z.dump.age"), "dump", Ct);
        await File.WriteAllTextAsync(Path.Combine(directory, "patika-20261026T030151Z.dump.age.sha256"), "sum  name", Ct);
        await File.WriteAllTextAsync(Path.Combine(directory, "patika-20261026T040000Z.dump.age"), "", Ct);
        await File.WriteAllTextAsync(Path.Combine(directory, "patika-20261026T040000Z.dump.age.sha256"), "sum  name", Ct);
        await File.WriteAllTextAsync(Path.Combine(directory, ".patika-20261026T110000Z.dump.age.partial"), "x", Ct);
        await File.WriteAllTextAsync(Path.Combine(directory, "notes.txt"), "x", Ct);

        var listed = (await new DirectoryBackupCatalog(directory).ListAsync(Ct)).OrderBy(c => c.Name, StringComparer.Ordinal).ToList();
        var selection = BackupNames.Select(listed, Now);

        Assert.Equal(["patika-20261025T030000Z.dump.age", "patika-20261026T030151Z.dump.age", "patika-20261026T040000Z.dump.age"],
            listed.Select(c => c.Name));
        Assert.Equal([false, true, true], listed.Select(c => c.HasChecksum));
        Assert.Equal([1L, 4L, 0L], listed.Select(c => c.Size));
        Assert.Equal("patika-20261026T030151Z.dump.age", selection.Newest!.Name);
        Assert.Equal(new DateTimeOffset(2026, 10, 26, 3, 1, 51, TimeSpan.Zero), selection.Newest.CreatedAt);
        Assert.Equal("patika-20261026T040000Z.dump.age", selection.Invalid!.Name);
        Assert.Empty(await new DirectoryBackupCatalog(Path.Combine(directory, "missing")).ListAsync(Ct));
    }

    private BackupVerifier Verifier(IBackupCatalog catalog, RecordingOpsAlerts alerts) => new(
        Options.Create(new BackupSettings { Directory = directory }), catalog, new FixedClock(Now), alerts,
        new BackupAlertState(), NullLogger<BackupVerifier>.Instance);

    private sealed class FakeCatalog(IReadOnlyList<BackupCandidate> objects, bool fail = false) : IBackupCatalog
    {
        public Task<IReadOnlyList<BackupCandidate>> ListAsync(CancellationToken cancellationToken) =>
            fail ? throw new IOException("unreachable") : Task.FromResult(objects);
    }
}

public sealed class OpsAlertTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task CostAlertsAreMailedToTheOpsAddressOncePerDayAndKindWithCountsOnly()
    {
        var mail = new RecordingEmailSender();
        var alerts = new EmailOpsAlerts(Options.Create(new OpsSettings { AlertEmail = "ops@example.org" }), mail, NullLogger<EmailOpsAlerts>.Instance);
        var counters = new InMemoryPushCounters();
        var settings = new PushSettings();
        settings.CostGuard.DailyCap = 10;
        settings.CostGuard.MaxEmailsPerDay = 3;
        var clock = new FixedClock(new DateTimeOffset(2026, 10, 26, 9, 0, 0, TimeSpan.Zero));
        var guard = new PushCostGuard(counters, Options.Create(settings), clock);
        var job = new CostGuardJob(guard, new CostAlertNotifier(NullLogger<CostAlertNotifier>.Instance, alerts), new CostGuardAlertState());
        var day = PushCostGuard.Today(clock.GetUtcNow());

        await counters.ReserveAsync(day, PushCostGuard.Channel, 10, 10, Ct);
        await job.RunOnceAsync(Ct);
        await job.RunOnceAsync(Ct);
        // The email cap is reached later the same day: it still gets its own alert.
        await counters.ReserveAsync(day, PushCostGuard.EmailChannel, 3, 3, Ct);
        await job.RunOnceAsync(Ct);
        await job.RunOnceAsync(Ct);

        Assert.Equal(2, mail.Messages.Count);
        Assert.All(mail.Messages, m =>
        {
            Assert.Equal("ops@example.org", m.To);
            Assert.Equal(EmailKind.OpsAlert, m.Kind);
            Assert.DoesNotContain("@", m.Body, StringComparison.Ordinal);
        });
        Assert.Contains("non-critical pushes cap reached", mail.Messages[0].Subject, StringComparison.Ordinal);
        Assert.Contains("3 of 3 non-critical emails used on 2026-10-26", mail.Messages[1].Body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task WithoutAnOpsAddressOnlyTheLogLineIsWritten()
    {
        var mail = new RecordingEmailSender();
        await new EmailOpsAlerts(Options.Create(new OpsSettings()), mail, NullLogger<EmailOpsAlerts>.Instance).RaiseAsync("s", "m", Ct);
        Assert.Empty(mail.Messages);
    }

    [Fact]
    public async Task AFailingTransportDoesNotFailTheJob()
    {
        var alerts = new EmailOpsAlerts(Options.Create(new OpsSettings { AlertEmail = "ops@example.org" }), new ThrowingEmailSender(),
            NullLogger<EmailOpsAlerts>.Instance);
        await alerts.RaiseAsync("s", "m", Ct);
    }

    private sealed class RecordingEmailSender : IEmailSender
    {
        public List<EmailMessage> Messages { get; } = [];

        public Task<EmailSendResult> SendAsync(EmailMessage message, CancellationToken cancellationToken)
        {
            Messages.Add(message);
            return Task.FromResult(EmailSendResult.Sent);
        }
    }

    private sealed class ThrowingEmailSender : IEmailSender
    {
        public Task<EmailSendResult> SendAsync(EmailMessage message, CancellationToken cancellationToken) => throw new HttpRequestException("down");
    }
}

public sealed class WorkerHostLoggingTests
{
    [Fact]
    public void WorkerLogsGoThroughTheMaskingPipeline()
    {
        var capture = new CaptureSink();
        var builder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings { EnvironmentName = Environments.Development });
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:Patika"] = "Host=localhost;Port=1;Database=unused",
        });
        builder.AddPatikaWorker();
        builder.Services.AddSingleton<ILogEventSink>(capture);
        using var provider = builder.Services.BuildServiceProvider();

        var logger = provider.GetRequiredService<ILogger<WorkerHostLoggingTests>>();
        logger.LogWarning("Fan-out for {Email} with {RefreshToken} at {Point}", "pamuk.sever@kedimahallesi.example",
            "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl", "41.012345,29.054321");

        var line = Assert.Single(capture.Events).RenderMessage();
        Assert.DoesNotContain("pamuk.sever", line, StringComparison.Ordinal);
        Assert.DoesNotContain("eyJ", line, StringComparison.Ordinal);
        Assert.Contains("p***@k***", line, StringComparison.Ordinal);
        Assert.Contains("41.012,29.054", line, StringComparison.Ordinal);
    }

    private sealed class CaptureSink : ILogEventSink
    {
        public List<LogEvent> Events { get; } = [];

        public void Emit(LogEvent logEvent) => Events.Add(logEvent);
    }
}

public sealed class RecordingOpsAlerts : IOpsAlerts
{
    public List<(string Subject, string Message)> Messages { get; } = [];

    public Task RaiseAsync(string subject, string message, CancellationToken cancellationToken)
    {
        Messages.Add((subject, message));
        return Task.CompletedTask;
    }
}
