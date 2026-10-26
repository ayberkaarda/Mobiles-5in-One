using Microsoft.Extensions.Options;
using Patika.Api.Features.Auth;

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
        services.AddPatikaEmailCodes(configuration);

        if (environment.IsDevelopment())
        {
            services.AddSingleton<IEmailSender>(provider => new DevelopmentFolderEmailSender(
                provider.GetRequiredService<IOptions<EmailSettings>>().Value.DevelopmentOutbox
                    ?? Path.Combine(Path.GetTempPath(), "patika-dev-mail"),
                provider.GetRequiredService<ILogger<DevelopmentFolderEmailSender>>()));
            return AddBudget(services, configuration);
        }

        var resend = configuration.GetSection(ResendSettings.SectionName).Get<ResendSettings>() ?? new ResendSettings();
        if (!resend.IsConfigured)
        {
            services.AddSingleton<IEmailSender, UnconfiguredEmailSender>();
            return AddBudget(services, configuration);
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
        return AddBudget(services, configuration);
    }
    private static IServiceCollection AddBudget(IServiceCollection services, IConfiguration configuration)
    {
        var registration = services.Last(d => d.ServiceType == typeof(IEmailSender));
        services.Remove(registration);
        services.AddScoped<Patika.Infrastructure.Security.IDailyEmailBudget, Patika.Infrastructure.Security.DailySendBudget>();
        services.AddSingleton<IEmailSender>(provider =>
        {
            var inner = registration.ImplementationFactory is { } factory
                ? (IEmailSender)factory(provider)
                : (IEmailSender)ActivatorUtilities.CreateInstance(provider, registration.ImplementationType!);
            return new BudgetedEmailSender(inner, provider.GetRequiredService<IServiceScopeFactory>(), configuration,
                provider.GetService<TimeProvider>() ?? TimeProvider.System, provider.GetRequiredService<ILogger<BudgetedEmailSender>>());
        });
        return services;
    }
}
