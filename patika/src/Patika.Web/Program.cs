using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Patika.Infrastructure.Logging;
using Patika.Infrastructure.Media;
using Patika.Infrastructure.Persistence;
using Patika.Infrastructure.Security;
using Patika.Web.Seo;
using Patika.Web.Services;
using Patika.Web.Services.Admin;
using Patika.Web.Services.PublicQueries;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddPatikaLogging();
builder.Services.AddRazorPages();
// The admin cookie carries the API tokens encrypted with this ring, and antiforgery tokens use it too. It is the
// Web's own ring (never the API/Worker ring, which also protects TOTP secrets and purchase tokens), persisted so a
// restart or a second instance does not sign every admin out.
var webKeys = builder.Services.AddDataProtection().SetApplicationName("Patika.Web");
if (builder.Configuration["DataProtection:KeysPath"] is { Length: > 0 } keysPath)
{
    webKeys.PersistKeysToFileSystem(new DirectoryInfo(keysPath));
}
else if (builder.Environment.IsProduction())
{
    throw new InvalidOperationException("DataProtection:KeysPath must point to persistent storage for the Web key ring.");
}

builder.Services.AddTrustedNetwork(builder.Configuration);
builder.Services.AddHsts(options =>
{
    options.MaxAge = TimeSpan.FromDays(730);
    options.IncludeSubDomains = true;
    options.Preload = true;
});
builder.Services.AddAdminConsole(builder.Configuration);
builder.Services.AddProblemDetails();
builder.Services.AddResponseCompression();
builder.Services.Configure<RouteOptions>(options =>
{
    options.LowercaseUrls = true;
    options.AppendTrailingSlash = false;
});
// The API runs in another process, so moderation cannot evict these entries: short lifetimes bound how long
// a withdrawn or expired post stays visible (docs/public-web-data.md, "Caching"). Public HTML carries no
// per-request value (no CSP nonce: the pages have no inline script, docs/security/hardening.md), so one cached
// body is valid for every visitor.
builder.Services.AddOutputCache(options =>
{
    options.AddBasePolicy(policy => policy
        .With(context => !context.HttpContext.Request.Path.StartsWithSegments("/admin") && HttpMethods.IsGet(context.HttpContext.Request.Method) && !(context.HttpContext.User.Identity?.IsAuthenticated ?? false))
        .Expire(TimeSpan.FromMinutes(5)).SetVaryByQuery("*").Tag("public-data"));
    options.AddPolicy(CachePolicies.AdoptionDetail, policy => policy.Expire(TimeSpan.FromSeconds(60)));
    options.AddPolicy(CachePolicies.Listing, policy => policy.Expire(TimeSpan.FromMinutes(2)));
});
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.Configure<StorageSettings>(builder.Configuration.GetSection(StorageSettings.SectionName));
builder.Services.Configure<MediaSettings>(builder.Configuration.GetSection(MediaSettings.SectionName));
builder.Services.AddSingleton<IPhotoUrlResolver, PhotoUrlResolver>();
builder.Services.AddDbContext<PatikaDbContext>((services, options) =>
{
    var connection = builder.Configuration.GetConnectionString("PatikaRead")
        ?? (builder.Environment.IsDevelopment() ? builder.Configuration.GetConnectionString("Patika") : null)
        ?? throw new InvalidOperationException("ConnectionStrings:PatikaRead is required.");
    options.UseNpgsql(connection, postgres => postgres.UseNetTopologySuite())
        .UseQueryTrackingBehavior(QueryTrackingBehavior.NoTracking);
});
builder.Services.AddScoped<PatikaDbContext>(services => new PublicReadContext(services.GetRequiredService<DbContextOptions<PatikaDbContext>>()));
builder.Services.AddScoped<IAdoptionQueries, AdoptionQueries>();
builder.Services.AddScoped<IPlaceQueries, PlaceQueries>();
builder.Services.AddScoped<ICarePlaceQueries, CarePlaceQueries>();
builder.Services.AddScoped<IImpactQueries, ImpactQueries>();
builder.Services.AddScoped<ISitemapQueries, SitemapQueries>();
builder.Services.AddSeo(builder.Configuration);

var app = builder.Build();
app.UseForwardedHeaders();
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler();
    app.UseHsts();
}
app.UseResponseCompression();
app.UseAdminPrivacy();
app.Use(async (context, next) =>
{
    context.Response.Headers["Permissions-Policy"] = "geolocation=(self), camera=(), microphone=()";
    context.Response.Headers.XContentTypeOptions = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    var media = builder.Configuration["Storage:PublicBaseUrl"] ?? builder.Configuration["Storage:PublicEndpoint"]
        ?? builder.Configuration["Storage:Endpoint"];
    var origin = Uri.TryCreate(media, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https"
        ? " " + uri.GetLeftPart(UriPartial.Authority) : "";
    context.Response.Headers.ContentSecurityPolicy = $"default-src 'self'; script-src 'self'; img-src 'self'{origin}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
    await next(context);
});
app.UseWhen(context => !context.Request.Path.StartsWithSegments("/admin"), branch => branch.UseStatusCodePagesWithReExecute("/404"));
app.UseStaticFiles();
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();
app.UseOutputCache();
app.MapGet("/healthz", () => Results.Ok(new { status = "ok" })).CacheOutput(policy => policy.NoCache());
app.MapSeo();
app.MapRazorPages();
app.Run();

public partial class Program;

