namespace Patika.Worker.Jobs.Push;

/// <summary>
/// One push to one device. <c>Critical</c> sends (urgent help) keep going above the soft daily cap;
/// non-critical sends pause there. Payloads carry ids only: no coordinates, names or free text.
/// </summary>
public sealed record PushMessage(
    string Token,
    string Title,
    string Body,
    IReadOnlyDictionary<string, string> Data,
    bool Critical);

public enum PushOutcome
{
    Sent,

    /// <summary>The provider says the token is gone; the registration is deleted.</summary>
    InvalidToken,

    /// <summary>Throttled or provider outage; not retried within the same run.</summary>
    Retryable,

    Failed,
}

/// <summary>Provider seam: FCM HTTP v1 now (ADR-0001, Android first), APNs later.</summary>
public interface IPushSender
{
    Task<PushOutcome> SendAsync(PushMessage message, CancellationToken cancellationToken);
}

/// <summary>Used when no provider is configured (local runs): counts sends, never logs tokens.</summary>
public sealed class LoggingPushSender(ILogger<LoggingPushSender> logger) : IPushSender
{
    public Task<PushOutcome> SendAsync(PushMessage message, CancellationToken cancellationToken)
    {
        logger.LogInformation("Push provider not configured; dropped one {Kind} push", message.Critical ? "critical" : "standard");
        return Task.FromResult(PushOutcome.Sent);
    }
}

public sealed class PushSettings
{
    public const string SectionName = "Push";

    public FcmSettings Fcm { get; set; } = new();

    public CostGuardSettings CostGuard { get; set; } = new();

    public int MaxDevicesPerPost { get; set; } = 500;

    /// <summary>Saved-area radius ceiling for urgent fan-out.</summary>
    public int MaxRadiusMeters { get; set; } = 2000;

    /// <summary>Registrations not refreshed for this long are skipped.</summary>
    public int StaleDeviceDays { get; set; } = 60;

    /// <summary>Posts older than this when first seen are not pushed (for example after an outage).</summary>
    public int FanoutWindowMinutes { get; set; } = 60;

    public int SendParallelism { get; set; } = 8;

    /// <summary>Urgent devices one author's posts may reach per local day; the rest of a post is deferred.</summary>
    public int MaxDevicesPerAuthorPerDay { get; set; } = 1_000;

    /// <summary>A deferred fan-out is retried after the daily budgets reset while the post is open and younger than this.</summary>
    public int DeferredFanoutHours { get; set; } = 24;
}

public sealed class FcmSettings
{
    public string? ProjectId { get; set; }

    /// <summary>Service-account JSON (from a secret). When absent, pushes go to <see cref="LoggingPushSender"/>.</summary>
    public string? ServiceAccountJson { get; set; }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ProjectId) && !string.IsNullOrWhiteSpace(ServiceAccountJson);
}

public sealed class CostGuardSettings
{
    /// <summary>Daily non-critical emails (top-level <c>CostGuard:MaxEmailsPerDay</c>, shared with the API).</summary>
    public int MaxEmailsPerDay { get; set; } = 5_000;

    /// <summary>Daily security-critical emails (top-level <c>CostGuard:MaxCriticalEmailsPerDay</c>, shared with the API).</summary>
    public int MaxCriticalEmailsPerDay { get; set; } = 20_000;

    /// <summary>Daily non-critical pushes; at this count they pause and an alert is raised.</summary>
    public int DailyCap { get; set; } = 5_000;

    /// <summary>Daily urgent pushes, counted separately from non-critical ones; past it fan-out is deferred.</summary>
    public int CriticalDailyCap { get; set; } = 20_000;
}
