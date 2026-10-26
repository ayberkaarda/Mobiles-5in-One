using System.Globalization;
using System.Text;

namespace Patika.Api.Email;

public enum EmailKind
{
    VerifyEmail,
    RegistrationAttempt,
    PasswordReset,
    DeletionScheduled,

    /// <summary>Operator alert from the Worker (cost guard, stale backup); never sent to users.</summary>
    OpsAlert,
}

/// <summary>An outgoing message. <see cref="Body"/> may contain a one-time token and is never logged.</summary>
public sealed record EmailMessage(string To, EmailKind Kind, string Subject, string Body);

public static class EmailKinds
{
    /// <summary>
    /// Security-critical mail (verification and reset codes, the registration-attempt notice, the
    /// deletion confirmation) draws on its own emergency budget and is never paused by the
    /// non-critical cap. A new kind is non-critical until it is listed here.
    /// </summary>
    public static bool IsCritical(EmailKind kind) => kind switch
    {
        EmailKind.VerifyEmail or EmailKind.RegistrationAttempt or EmailKind.PasswordReset or EmailKind.DeletionScheduled => true,
        _ => false,
    };
}

public enum EmailSendStatus
{
    /// <summary>Handed to the transport.</summary>
    Sent,

    /// <summary>The transport dropped or rejected the message (the transport logs why).</summary>
    NotDelivered,

    /// <summary>The daily budget for this kind is used up; nothing was sent.</summary>
    SkippedDailyCap,

    /// <summary>The recipient's daily limit for critical mail is used up; nothing was sent.</summary>
    SkippedRecipientLimit,
}

/// <summary>What happened to a message. <see cref="RetryAfter"/> is set when a budget skipped it.</summary>
public readonly record struct EmailSendResult(EmailSendStatus Status, TimeSpan? RetryAfter = null)
{
    public static EmailSendResult Sent => new(EmailSendStatus.Sent);

    public static EmailSendResult NotDelivered => new(EmailSendStatus.NotDelivered);

    public bool Skipped => Status is EmailSendStatus.SkippedDailyCap or EmailSendStatus.SkippedRecipientLimit;
}

public interface IEmailSender
{
    Task<EmailSendResult> SendAsync(EmailMessage message, CancellationToken cancellationToken);

    /// <summary>
    /// Null while the daily budget for <paramref name="kind"/> has room, otherwise the time until it
    /// resets. Callers that must answer the same way whether or not they send (unknown addresses)
    /// ask this first. A plain transport has no budget.
    /// </summary>
    Task<TimeSpan?> PausedForAsync(EmailKind kind, CancellationToken cancellationToken) => Task.FromResult<TimeSpan?>(null);
}

public sealed class EmailSettings
{
    public const string SectionName = "Email";

    /// <summary>Folder used by the Development sender; defaults to a folder under the system temp path.</summary>
    public string? DevelopmentOutbox { get; set; }
}

/// <summary>Development only: writes each message to a file in a local folder, never to the logs.</summary>
public sealed class DevelopmentFolderEmailSender(string folder, ILogger<DevelopmentFolderEmailSender> logger) : IEmailSender
{
    public async Task<EmailSendResult> SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(folder);
        var name = string.Create(CultureInfo.InvariantCulture,
            $"{DateTimeOffset.UtcNow:yyyyMMddTHHmmssfff}-{message.Kind}-{Guid.NewGuid():N}.txt");
        var content = new StringBuilder()
            .Append("To: ").AppendLine(message.To)
            .Append("Subject: ").AppendLine(message.Subject)
            .AppendLine()
            .AppendLine(message.Body)
            .ToString();
        await File.WriteAllTextAsync(Path.Combine(folder, name), content, cancellationToken);
        logger.LogInformation("Development email of kind {Kind} written to the local outbox", message.Kind);
        return EmailSendResult.Sent;
    }
}

/// <summary>
/// Fallback outside Development when <c>Resend:ApiKey</c> is not set: the message is dropped and only
/// its kind is logged, so the API keeps working without leaking addresses or tokens.
/// </summary>
public sealed class UnconfiguredEmailSender(ILogger<UnconfiguredEmailSender> logger) : IEmailSender
{
    public Task<EmailSendResult> SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        logger.LogWarning("No email provider is configured; dropped a message of kind {Kind}", message.Kind);
        return Task.FromResult(EmailSendResult.NotDelivered);
    }
}
