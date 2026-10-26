using System.Text.Json.Serialization;
using FluentValidation;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.Options;
using Patika.Api.Email;
using Patika.Api.Features.Account;
using Patika.Api.Features.Auth;
using Patika.Api.Features.Devices;
using Patika.Api.Features.Media;
using Patika.Api.Features.Urgent;
using Patika.Api.Logging;
using Patika.Api.OpenApi;
using Patika.Api.Security;
using Patika.Api.Security.Authorization;
using Patika.Api.Security.Passwords;
using Patika.Api.Security.RateLimiting;
using Patika.Api.Security.Tokens;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using Serilog.Formatting.Compact;

namespace Patika.Api;

public static class PatikaApiServices
{
    public const string GenericErrorTitle = "An unexpected error occurred.";

    public static WebApplicationBuilder AddPatikaApi(this WebApplicationBuilder builder)
    {
        var services = builder.Services;
        var configuration = builder.Configuration;

        builder.WebHost.ConfigureKestrel(kestrel =>
        {
            kestrel.AddServerHeader = false;
            kestrel.Limits.MaxRequestBodySize = HttpHardening.MaxRequestBodyBytes;
        });

        // Every sink (console plus any registered in DI, such as test capture) sits behind the
        // exception scrubber, and the masking enricher runs last, so no sink sees raw user data.
        services.AddSerilog((provider, logger) => logger
            .MinimumLevel.Information()
            .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
            .MinimumLevel.Override("Microsoft.Hosting.Lifetime", LogEventLevel.Information)
            .MinimumLevel.Override("System", LogEventLevel.Warning)
            .Enrich.FromLogContext()
            .Enrich.With<MaskingEnricher>()
            .WriteTo.Sink(new ExceptionScrubbingSink(
            [
                .. provider.GetServices<ILogEventSink>(),
                new LoggerConfiguration().WriteTo.Console(new RenderedCompactJsonFormatter()).CreateLogger(),
            ])),
            preserveStaticLogger: true);

        services.AddProblemDetails(options => options.CustomizeProblemDetails = context =>
        {
            var problem = context.ProblemDetails;
            var status = problem.Status ?? context.HttpContext.Response.StatusCode;
            if (status >= StatusCodes.Status500InternalServerError)
            {
                // Nothing about the failure leaves the process: generic title, machine code, trace id.
                problem.Title = GenericErrorTitle;
                problem.Detail = null;
                problem.Type = null;
                problem.Instance = null;
                problem.Extensions.Clear();
            }

            problem.Extensions["traceId"] = HttpHardening.TraceId(context.HttpContext);
            if (!problem.Extensions.ContainsKey("code"))
            {
                problem.Extensions["code"] = $"http_{status}";
            }
        });

        services.Configure<JsonOptions>(options =>
        {
            options.SerializerOptions.UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow;
            options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
        });
        services.Configure<RouteHandlerOptions>(options => options.ThrowOnBadRequest = false);

        services.AddPatikaHttpHardening(configuration);
        services.AddPatikaRateLimiting();

        services.AddValidatorsFromAssemblyContaining<RegisterRequestValidator>(ServiceLifetime.Singleton);

        services.AddSingleton(TimeProvider.System);
        services.AddOptions<JwtSettings>().Bind(configuration.GetSection(JwtSettings.SectionName));
        services.AddOptions<GoogleSettings>().Bind(configuration.GetSection(GoogleSettings.SectionName));
        var allowEphemeralKey = builder.Environment.IsDevelopment();
        services.AddSingleton(provider =>
        {
            var key = JwtSigningKey.Create(provider.GetRequiredService<IOptions<JwtSettings>>().Value.SigningKey, allowEphemeralKey);
            if (key.IsEphemeral)
            {
                provider.GetRequiredService<ILogger<JwtSigningKey>>()
                    .LogWarning("Jwt:SigningKey is not set; using an ephemeral development key");
            }

            return key;
        });
        services.AddSingleton<IAccessTokenIssuer, AccessTokenIssuer>();
        services.AddSingleton<IPasswordHasher, Argon2idPasswordHasher>();
        services.AddHttpClient<IBreachedPasswordChecker, HibpBreachedPasswordChecker>(client =>
        {
            client.BaseAddress = new Uri("https://api.pwnedpasswords.com/");
            client.Timeout = TimeSpan.FromSeconds(3);
            client.DefaultRequestHeaders.UserAgent.ParseAdd("Patika-Api");
        });
        services.AddSingleton(_ => GoogleIdTokenVerifier.CreateConfigurationManager());
        services.AddSingleton<IExternalIdentityVerifier, GoogleIdTokenVerifier>();
        services.AddScoped<IAuthStore, EfAuthStore>();
        services.AddScoped<AuthHandlers>();
        // TOTP secrets are encrypted with this key ring; losing it makes every enrolled authenticator unusable.
        var dataProtection = services.AddDataProtection().SetApplicationName("Patika.Api");
        if (configuration["DataProtection:KeysPath"] is { Length: > 0 } keysPath)
        {
            dataProtection.PersistKeysToFileSystem(new DirectoryInfo(keysPath));
        }
        else if (builder.Environment.IsProduction())
        {
            throw new InvalidOperationException("DataProtection:KeysPath must point to persistent storage shared by every API instance.");
        }

        services.AddScoped<TotpService>();
        services.AddScoped<Patika.Api.Features.Admin.AdminHandlers>();
        services.AddSingleton<Patika.Api.Features.Admin.AdminPhotoUrls>();
        services.AddAdminAuthorization();
        services.AddPatikaEmail(configuration, builder.Environment);
        services.AddPatikaAccount();
        services.AddPatikaSessionVersionCheck();
        services.AddMediaServices(configuration);
        services.AddUrgentServices();
        services.AddDeviceServices();
        services.AddPatikaOpenApi();

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
        services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
            .Configure<JwtSigningKey, IOptions<JwtSettings>>((options, key, settings) =>
            {
                options.MapInboundClaims = false;
                options.RequireHttpsMetadata = false;
                options.TokenValidationParameters = AccessTokenIssuer.ValidationParameters(key, settings.Value);
                options.Events = new JwtBearerEvents
                {
                    // A signed token is not enough: the account must still exist and be active.
                    OnTokenValidated = async context =>
                    {
                        var actor = ActorFactory.FromPrincipal(context.Principal);
                        var store = context.HttpContext.RequestServices.GetRequiredService<IAuthStore>();
                        var user = actor.UserId is { } id ? await store.FindUserByIdAsync(id, context.HttpContext.RequestAborted) : null;
                        var clock = context.HttpContext.RequestServices.GetRequiredService<TimeProvider>();
                        if (user is null || !user.IsActive || user.Role != actor.Role || user.SuspendedUntil > clock.GetUtcNow())
                        {
                            context.Fail("Account is not active.");
                        }
                    },
                };
            });
        services.AddAuthorization();
        services.AddSingleton<IAuthorizationHandler, PermissionAuthorizationHandler>();
        services.AddSingleton<IAuthorizationHandler, OwnerOrModeratorHandler>();

        return builder;
    }

    public static WebApplication UsePatikaApi(this WebApplication app)
    {
        app.UseApiSecurityHeaders();
        if (HttpHardening.HasTrustedProxies(app.Configuration))
        {
            app.UseForwardedHeaders();
        }

        app.UseExceptionHandler();
        app.UseStatusCodePages();
        if (!app.Environment.IsDevelopment())
        {
            app.UseHsts();
        }

        // Path only (no query string, headers or bodies); the request id ties the line to handler logs.
        app.UseSerilogRequestLogging(options =>
        {
            options.Logger = app.Services.GetRequiredService<Serilog.ILogger>();
            options.MessageTemplate = "HTTP {RequestMethod} {RequestPath} responded {StatusCode} in {Elapsed:0.0} ms";
            options.EnrichDiagnosticContext = (diagnostics, context) => diagnostics.Set("RequestId", context.TraceIdentifier);
        });
        app.UseRequestBodyLimit();
        app.UseRouting();
        if (HttpHardening.IsCorsEnabled(app.Configuration))
        {
            app.UseCors(CorsSettings.PolicyName);
        }

        app.UseRateLimiter();
        app.UseAuthentication();
        app.UseAuthorization();
        return app;
    }
}
