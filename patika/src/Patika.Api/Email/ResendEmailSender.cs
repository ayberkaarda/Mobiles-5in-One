using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace Patika.Api.Email;

public sealed class ResendSettings
{
    public const string SectionName = "Resend";

    /// <summary>From the environment (<c>Resend__ApiKey</c>); never from a committed file.</summary>
    public string? ApiKey { get; set; }

    public string From { get; set; } = "Patika <bildirim@patika.app>";

    public string? ReplyTo { get; set; }

    public Uri BaseAddress { get; set; } = new("https://api.resend.com/");

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiKey);
}

/// <summary>Request body for <c>POST /emails</c> of the Resend HTTP API.</summary>
internal sealed record ResendEmailRequest(
    [property: JsonPropertyName("from")] string From,
    [property: JsonPropertyName("to")] string[] To,
    [property: JsonPropertyName("subject")] string Subject,
    [property: JsonPropertyName("text")] string Text,
    [property: JsonPropertyName("reply_to"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ReplyTo,
    [property: JsonPropertyName("tags")] ResendTag[] Tags);

internal sealed record ResendTag(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("value")] string Value);

/// <summary>
/// Sends through the Resend HTTP API. Delivery failures are logged with the message kind and the
/// HTTP status only (never the address, subject or body) and are not rethrown, so every caller
/// answers the same way whether or not a message went out.
/// </summary>
public sealed class ResendEmailSender(
    IHttpClientFactory httpClients, IOptions<ResendSettings> options, ILogger<ResendEmailSender> logger)
    : IEmailSender
{
    public const string HttpClientName = "resend";

    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        var settings = options.Value;
        if (!settings.IsConfigured)
        {
            logger.LogError("Resend is not configured; dropped a message of kind {Kind}", message.Kind);
            return;
        }

        var body = new ResendEmailRequest(settings.From, [message.To], message.Subject, message.Body, settings.ReplyTo,
            [new ResendTag("kind", TagValue(message.Kind))]);
        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(settings.BaseAddress, "emails"))
        {
            Content = JsonContent.Create(body),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.ApiKey);
        request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString("N"));

        try
        {
            var http = httpClients.CreateClient(HttpClientName);
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (response.IsSuccessStatusCode)
            {
                logger.LogInformation("Email of kind {Kind} accepted by Resend", message.Kind);
            }
            else
            {
                logger.LogError("Resend rejected an email of kind {Kind} with status {StatusCode}",
                    message.Kind, (int)response.StatusCode);
            }
        }
        catch (Exception exception) when (exception is HttpRequestException
            || (exception is TaskCanceledException && !cancellationToken.IsCancellationRequested))
        {
            // The exception object is not logged: transport messages can echo request details.
            logger.LogError("Sending an email of kind {Kind} through Resend failed ({Failure})",
                message.Kind, exception.GetType().Name);
        }
    }

    internal static string TagValue(EmailKind kind) => kind switch
    {
        EmailKind.VerifyEmail => "verify_email",
        EmailKind.RegistrationAttempt => "registration_attempt",
        EmailKind.PasswordReset => "password_reset",
        EmailKind.DeletionScheduled => "deletion_scheduled",
        _ => "other",
    };
}
