using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Patika.Api.Email;

namespace Patika.Worker.Jobs.Ops;

public sealed class OpsSettings
{
    public const string SectionName = "Ops";

    /// <summary>Operator mailbox for Worker alerts (cost guard, stale backup). Empty means log lines only.</summary>
    public string? AlertEmail { get; set; }
}

/// <summary>Operator alerts raised by Worker jobs. Messages carry counts, days and ages only, never user data.</summary>
public interface IOpsAlerts
{
    Task RaiseAsync(string subject, string message, CancellationToken cancellationToken);
}

/// <summary>
/// Sends the alert to <c>Ops:AlertEmail</c> through the same transport the API uses (Resend, or the folder sender
/// in Development). It goes straight to the transport, not through the daily email budget: an alert about the email
/// cap must not be stopped by that cap, and each alert fires at most once per day and kind.
/// </summary>
public sealed class EmailOpsAlerts(IOptions<OpsSettings> options, IEmailSender transport, ILogger<EmailOpsAlerts> logger) : IOpsAlerts
{
    public async Task RaiseAsync(string subject, string message, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(options.Value.AlertEmail))
        {
            return;
        }

        try
        {
            await transport.SendAsync(new EmailMessage(options.Value.AlertEmail, EmailKind.OpsAlert, "[Patika] " + subject, message), cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // The alert log line has already been written by the caller; a failed email must not fail the job.
            logger.LogError("Ops alert email could not be sent ({Failure})", exception.GetType().Name);
        }
    }
}

public static class OpsSetup
{
    /// <summary>
    /// Development writes alert mail to the local outbox; elsewhere Resend is used when <c>Resend:ApiKey</c> is set,
    /// otherwise the unconfigured sender drops the mail with a warning and the log line remains the alert.
    /// </summary>
    public static IServiceCollection AddOpsAlerts(this IServiceCollection services, IConfiguration configuration, IHostEnvironment environment)
    {
        services.AddOptions<OpsSettings>().Bind(configuration.GetSection(OpsSettings.SectionName));
        services.AddOptions<EmailSettings>().Bind(configuration.GetSection(EmailSettings.SectionName));
        services.AddOptions<ResendSettings>().Bind(configuration.GetSection(ResendSettings.SectionName));
        var resend = configuration.GetSection(ResendSettings.SectionName).Get<ResendSettings>() ?? new ResendSettings();
        if (environment.IsDevelopment())
        {
            services.TryAddSingleton<IEmailSender>(provider => new DevelopmentFolderEmailSender(
                provider.GetRequiredService<IOptions<EmailSettings>>().Value.DevelopmentOutbox
                    ?? Path.Combine(Path.GetTempPath(), "patika-dev-mail"),
                provider.GetRequiredService<ILogger<DevelopmentFolderEmailSender>>()));
        }
        else if (resend.IsConfigured)
        {
            services.AddHttpClient(ResendEmailSender.HttpClientName, client => client.Timeout = TimeSpan.FromSeconds(10));
            services.TryAddSingleton<IEmailSender, ResendEmailSender>();
        }
        else
        {
            services.TryAddSingleton<IEmailSender, UnconfiguredEmailSender>();
        }

        services.TryAddSingleton<IOpsAlerts, EmailOpsAlerts>();
        return services;
    }
}
