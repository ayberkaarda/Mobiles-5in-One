using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Patika.Api.Features.Admin;
using Patika.Api.Features.Auth;
using Patika.Api.Security.Tokens;
using Patika.Api.Tests.Infrastructure;
using Patika.Api.Tests.Urgent;
using Patika.Contracts.Admin;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;
using Xunit;

namespace Patika.Api.Tests.Admin;

internal sealed class AdminTestRig : IAsyncDisposable
{
    public static readonly byte[] Secret = Encoding.ASCII.GetBytes("12345678901234567890");
    public PatikaApiFactory Factory { get; } = new();
    public TestClock Clock { get; } = new();
    public IDataProtectionProvider Protection { get; } = new EphemeralDataProtectionProvider();
    private int peer;

    public AdminTestRig(FeaturePostgisFixture database)
    {
        Factory.ExtraServices = services =>
        {
            services.RemoveAll<IAuthStore>();
            services.AddScoped<IAuthStore, EfAuthStore>();
            services.RemoveAll<PatikaDbContext>();
            services.RemoveAll<DbContextOptions<PatikaDbContext>>();
            services.AddDbContext<PatikaDbContext>(o => o.UseNpgsql(database.ConnectionString, p => p.UseNetTopologySuite()));
            services.AddSingleton<TimeProvider>(Clock);
            services.AddSingleton(Protection);
        };
    }

    public User User(UserRole role = UserRole.Moderator, bool enabled = true) => new()
    {
        DisplayName = "Review",
        Email = $"review.{Guid.NewGuid():N}@example.org",
        Role = role,
        EmailVerifiedAt = Clock.Now,
        TotpSecretEnc = Protection.CreateProtector("Patika.Totp.v1").Protect(Convert.ToBase64String(Secret)),
        TotpEnabledAt = enabled ? Clock.Now : null,
    };

    public TotpService Totp(PatikaDbContext db) => new(db, Protection, Factory.Services.GetRequiredService<EmailCodeHasher>(),
        Factory.Services.GetRequiredService<IAccessTokenIssuer>(), Options.Create(new JwtSettings()), Clock,
        Factory.Services.GetRequiredService<Patika.Api.Security.RateLimiting.TotpRateLimiter>());

    public AdminHandlers Handlers(PatikaDbContext db) => new(db, Totp(db), Factory.Services.GetRequiredService<EmailCodeHasher>(),
        Factory.Services.GetRequiredService<AdminPhotoUrls>(), Clock);

    public string Code => TotpAlgorithm.Code(Secret, Clock.Now.ToUnixTimeSeconds() / 30);

    public DefaultHttpContext Http(User user, Guid? session = null)
    {
        var http = new DefaultHttpContext();
        http.User = new ClaimsPrincipal(new ClaimsIdentity(
        [
            new Claim("sub", user.Id.ToString()), new Claim("role", user.Role.ToString()), new Claim("sv", user.SessionVersion.ToString()),
            new Claim("sid", (session ?? user.Id).ToString()), new Claim("amr", "mfa"),
            new Claim("auth_time", Clock.Now.ToUnixTimeSeconds().ToString()),
        ], "Bearer", "sub", "role"));
        return http;
    }

    public async Task<string> StepAsync(PatikaDbContext db, User user, string action, object target, Guid? session = null)
    {
        Clock.Now = Clock.Now.AddSeconds(30);
        var result = await Totp(db).StepUpAsync(Http(user, session).User, new StepUpRequest(Code, "Review for safety", action, target.ToString()!), TestContext.Current.CancellationToken);
        return ((Microsoft.AspNetCore.Http.HttpResults.Ok<StepUpResponse>)result).Value!.StepUpToken;
    }

    public async Task<HttpResponseMessage> SendAsync(string path, object? body = null, string? bearer = null)
    {
        using var client = Factory.CreateApiClient($"203.0.113.{Interlocked.Increment(ref peer) % 250 + 1}");
        if (bearer is not null) client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        return body is null ? await client.GetAsync(path, TestContext.Current.CancellationToken)
            : await client.PostAsJsonAsync(path, body, TestContext.Current.CancellationToken);
    }

    public async ValueTask DisposeAsync() => await Factory.DisposeAsync();
}

internal sealed class TestClock : TimeProvider
{
    public DateTimeOffset Now { get; set; } = DateTimeOffset.FromUnixTimeSeconds(DateTimeOffset.UtcNow.ToUnixTimeSeconds());
    public override DateTimeOffset GetUtcNow() => Now;
}
