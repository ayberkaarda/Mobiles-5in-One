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

public interface IEmailSender
{
    Task SendAsync(EmailMessage message, CancellationToken cancellationToken);
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
    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
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
    }
}

/// <summary>
/// Fallback outside Development when <c>Resend:ApiKey</c> is not set: the message is dropped and only
/// its kind is logged, so the API keeps working without leaking addresses or tokens.
/// </summary>
public sealed class UnconfiguredEmailSender(ILogger<UnconfiguredEmailSender> logger) : IEmailSender
{
    public Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        logger.LogWarning("No email provider is configured; dropped a message of kind {Kind}", message.Kind);
        return Task.CompletedTask;
    }
}
