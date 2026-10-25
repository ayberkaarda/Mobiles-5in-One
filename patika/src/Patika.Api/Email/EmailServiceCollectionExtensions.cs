using Microsoft.Extensions.Options;

namespace Patika.Api.Email;

public static class EmailServiceCollectionExtensions
{
    /// <summary>
    /// Development writes to a local folder; elsewhere Resend is used when <c>Resend:ApiKey</c>
    /// (env <c>Resend__ApiKey</c>) is set, otherwise messages are dropped with a warning.
    /// </summary>
    public static IServiceCollection AddPatikaEmail(
        this IServiceCollection services, IConfiguration configuration, IHostEnvironment environment)
    {
        services.AddOptions<EmailSettings>().Bind(configuration.GetSection(EmailSettings.SectionName));
        services.AddOptions<ResendSettings>().Bind(configuration.GetSection(ResendSettings.SectionName));

        if (environment.IsDevelopment())
        {
            services.AddSingleton<IEmailSender>(provider => new DevelopmentFolderEmailSender(
                provider.GetRequiredService<IOptions<EmailSettings>>().Value.DevelopmentOutbox
                    ?? Path.Combine(Path.GetTempPath(), "patika-dev-mail"),
                provider.GetRequiredService<ILogger<DevelopmentFolderEmailSender>>()));
            return services;
        }

        var resend = configuration.GetSection(ResendSettings.SectionName).Get<ResendSettings>() ?? new ResendSettings();
        if (!resend.IsConfigured)
        {
            services.AddSingleton<IEmailSender, UnconfiguredEmailSender>();
            return services;
        }

        services.AddHttpClient(ResendEmailSender.HttpClientName, client =>
        {
            client.Timeout = TimeSpan.FromSeconds(10);
            client.DefaultRequestHeaders.UserAgent.ParseAdd("Patika-Api");
        });
        services.AddSingleton<IEmailSender>(provider => new ResendEmailSender(
            provider.GetRequiredService<IHttpClientFactory>(),
            provider.GetRequiredService<IOptions<ResendSettings>>(),
            provider.GetRequiredService<ILogger<ResendEmailSender>>()));
        return services;
    }
}
