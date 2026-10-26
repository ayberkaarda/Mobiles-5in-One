using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.WebUtilities;
using Patika.Contracts.Auth;

namespace Patika.Web.Services.Admin;

public static class AdminSession
{
    public const string Scheme = "PatikaAdmin";
    public const string Moderate = "PatikaAdmin.Moderate";
    public const string Manage = "PatikaAdmin.Manage";
    public const string Issued = "admin_issued";

    public static IApplicationBuilder UseAdminPrivacy(this IApplicationBuilder app) => app.Use(async (context, next) =>
    {
        if (context.Request.Path.StartsWithSegments("/admin", StringComparison.OrdinalIgnoreCase))
        {
            context.Response.OnStarting(() =>
            {
                context.Response.Headers.CacheControl = "no-store";
                context.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
                context.Response.Headers.XFrameOptions = "DENY";
                context.Response.Headers.ContentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
                return Task.CompletedTask;
            });
        }
        await next(context);
    });

    public static IServiceCollection AddAdminConsole(this IServiceCollection services, IConfiguration configuration)
    {
        // A key that is set but too short stops the host here, not at the first sign-in.
        _ = Patika.Infrastructure.Security.TrustedNetwork.ReadBffKey(configuration);
        services.AddHttpContextAccessor();
        services.AddTransient<BffClientAddressHandler>();
        services.AddHttpClient("PatikaAdmin", client =>
        {
            client.BaseAddress = new Uri(configuration["Admin:ApiBaseUrl"] ?? "https://localhost:7001");
            client.Timeout = TimeSpan.FromSeconds(30);
        }).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { UseCookies = false, AllowAutoRedirect = false })
            .AddHttpMessageHandler<BffClientAddressHandler>();
        services.AddSingleton<BffSelfCheck>();
        services.AddHostedService<BffStartupCheck>();
        services.AddSingleton<AdminRefresh>();
        services.AddScoped<AdminApi>();
        services.AddAuthentication(Scheme).AddCookie(Scheme, options =>
        {
            options.Cookie.Name = "PatikaAdmin";
            options.Cookie.Path = "/admin";
            options.Cookie.HttpOnly = true;
            options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
            options.Cookie.SameSite = SameSiteMode.Strict;
            options.LoginPath = "/admin/giris";
            options.ExpireTimeSpan = TimeSpan.FromMinutes(30);
            options.SlidingExpiration = true;
            options.Events.OnRedirectToAccessDenied = context =>
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                return Task.CompletedTask;
            };
            options.Events.OnValidatePrincipal = ValidateAsync;
        });
        services.AddOptions<CookieAuthenticationOptions>(Scheme).Configure<TimeProvider>((options, clock) => options.TimeProvider = clock);
        services.AddAuthorization(options =>
        {
            options.AddPolicy(Moderate, policy => policy.AddAuthenticationSchemes(Scheme).RequireAuthenticatedUser()
                .RequireRole("Moderator", "Admin").RequireClaim("amr", "mfa"));
            options.AddPolicy(Manage, policy => policy.AddAuthenticationSchemes(Scheme).RequireAuthenticatedUser()
                .RequireRole("Admin").RequireClaim("amr", "mfa"));
        });
        services.Configure<Microsoft.AspNetCore.Mvc.RazorPages.RazorPagesOptions>(options =>
        {
            options.Conventions.AuthorizeAreaFolder("Admin", "/", Moderate);
            options.Conventions.AllowAnonymousToAreaPage("Admin", "/Login");
            foreach (var page in new[] { "/Users", "/Audit", "/Csv" })
                options.Conventions.AuthorizeAreaPage("Admin", page, Manage);
        });
        return services;
    }

    public static ClaimsPrincipal Principal(string accessToken)
    {
        using var document = JsonDocument.Parse(WebEncoders.Base64UrlDecode(accessToken.Split('.')[1]));
        var claims = new List<Claim>();
        foreach (var property in document.RootElement.EnumerateObject())
        {
            if (property.Name is not ("sub" or "role" or "amr")) continue;
            if (property.Value.ValueKind == JsonValueKind.Array)
                claims.AddRange(property.Value.EnumerateArray().Select(value => new Claim(property.Name, value.GetString()!)));
            else claims.Add(new Claim(property.Name, property.Value.GetString()!));
        }
        return new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme, "sub", "role"));
    }

    public static void Store(AuthenticationProperties properties, TokenResponse tokens, TimeProvider clock)
    {
        properties.StoreTokens([
            new AuthenticationToken { Name = "access_token", Value = tokens.AccessToken },
            new AuthenticationToken { Name = "refresh_token", Value = tokens.RefreshToken },
            new AuthenticationToken { Name = "expires_at", Value = clock.GetUtcNow().AddSeconds(tokens.ExpiresIn).ToString("O", CultureInfo.InvariantCulture) }
        ]);
    }

    private static async Task ValidateAsync(CookieValidatePrincipalContext context)
    {
        var clock = context.HttpContext.RequestServices.GetRequiredService<TimeProvider>();
        if (!long.TryParse(context.Principal?.FindFirstValue(Issued), out var issued)
            || clock.GetUtcNow() - DateTimeOffset.FromUnixTimeSeconds(issued) >= TimeSpan.FromHours(8))
        {
            context.RejectPrincipal();
            await context.HttpContext.SignOutAsync(Scheme);
            return;
        }
        if (DateTimeOffset.TryParse(context.Properties.GetTokenValue("expires_at"), CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind, out var expires) && expires > clock.GetUtcNow().AddMinutes(1)) return;
        try
        {
            var tokens = await context.HttpContext.RequestServices.GetRequiredService<AdminRefresh>()
                .RefreshAsync(context.Properties.GetTokenValue("refresh_token") ?? "", context.HttpContext.RequestAborted);
            var principal = Principal(tokens.AccessToken);
            if (!Allowed(principal)) throw new AdminApiException(403, "admin_access_revoked");
            ((ClaimsIdentity)principal.Identity!).AddClaim(new Claim(Issued, issued.ToString(CultureInfo.InvariantCulture)));
            Store(context.Properties, tokens, clock);
            context.ReplacePrincipal(principal);
            context.ShouldRenew = true;
        }
        catch (Exception ex) when (ex is AdminApiException or HttpRequestException or TaskCanceledException or JsonException)
        {
            context.RejectPrincipal();
            await context.HttpContext.SignOutAsync(Scheme);
        }
    }

    public static bool Allowed(ClaimsPrincipal principal) =>
        (principal.IsInRole("Admin") || principal.IsInRole("Moderator")) && principal.HasClaim("amr", "mfa");
}

