using System.Globalization;
using System.Text;

namespace Patika.Api.Email;

public enum EmailKind
{
    VerifyEmail,
    RegistrationAttempt,
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
/// Placeholder outside Development until the Resend sender lands: the message is dropped and only
/// its kind is logged, so registration keeps working without leaking addresses or tokens.
/// </summary>
public sealed class UnconfiguredEmailSender(ILogger<UnconfiguredEmailSender> logger) : IEmailSender
{
    public Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        logger.LogWarning("No email provider is configured; dropped a message of kind {Kind}", message.Kind);
        return Task.CompletedTask;
    }
}

public static class AuthEmails
{
    public static EmailMessage Verification(string to, string token) => new(
        to,
        EmailKind.VerifyEmail,
        "Patika: e-posta adresini doğrula",
        $"Patika hesabını etkinleştirmek için bu kodu uygulamada gir (24 saat geçerli):\n\n{token}\n\n"
        + "Bu isteği sen yapmadıysan bu iletiyi yok sayabilirsin.");

    public static EmailMessage RegistrationAttempt(string to) => new(
        to,
        EmailKind.RegistrationAttempt,
        "Patika: hesabın için kayıt denemesi",
        "Bu e-posta adresiyle zaten bir Patika hesabı var. Yeni bir kayıt denendi; hesabın değişmedi.\n\n"
        + "Sen değilsen bir şey yapmana gerek yok. Şifreni hatırlamıyorsan uygulamadaki giriş ekranını kullan.");
}
