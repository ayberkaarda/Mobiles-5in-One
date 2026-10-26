extern alias Api;

using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Patika.Api.Tests.Urgent;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;
using Xunit;
using ApiPasswordHasher = Api::Patika.Api.Security.Passwords.IPasswordHasher;
using ApiTotp = Api::Patika.Api.Features.Auth.TotpAlgorithm;

namespace Patika.Web.Tests.Admin;

public sealed class AdminFlowFixture : IAsyncLifetime
{
    public FeaturePostgisFixture Database { get; } = new();
    public ValueTask InitializeAsync() => Database.InitializeAsync();
    public ValueTask DisposeAsync() => Database.DisposeAsync();
}

internal sealed class AdminFlow : IAsyncDisposable
{
    private static readonly byte[] Secret = Encoding.ASCII.GetBytes("12345678901234567890");
    private readonly AdminFlowFixture fixture;
    public const string Password = "secure-password-42";
    public AdminClock Clock { get; } = new();
    public IDataProtectionProvider Protection { get; } = new EphemeralDataProtectionProvider();
    public WebApplicationFactory<Api::Program> Api { get; }
    public WebApplicationFactory<Program> Web { get; }
    public HttpClient Browser { get; }
    public string Code => ApiTotp.Code(Secret, Clock.Now.ToUnixTimeSeconds() / 30);

    public AdminFlow(AdminFlowFixture fixture)
    {
        this.fixture = fixture;
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var signingKey = Convert.ToBase64String(key.ExportPkcs8PrivateKey());
        Api = new WebApplicationFactory<Api::Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureLogging(logging => logging.ClearProviders().AddConsole());
            builder.UseSetting("Jwt:SigningKey", signingKey);
            builder.UseSetting("ConnectionStrings:Patika", fixture.Database.ConnectionString);
            builder.UseSetting("Billing:AllowFake", "true");
            builder.ConfigureServices(services =>
            {
                services.Replace(ServiceDescriptor.Singleton<TimeProvider>(Clock));
                services.AddSingleton(Protection);
            });
        });
        Web = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureLogging(logging => logging.ClearProviders().AddConsole());
            builder.UseSetting("ConnectionStrings:PatikaRead", fixture.Database.ConnectionString);
            builder.UseSetting("Admin:ApiBaseUrl", "https://api.test");
            builder.ConfigureServices(services =>
            {
                services.Replace(ServiceDescriptor.Singleton<TimeProvider>(Clock));
                services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());
                services.AddHttpClient("PatikaAdmin").ConfigurePrimaryHttpMessageHandler(() => Api.Server.CreateHandler());
            });
        });
        Browser = Web.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });
    }

    public async Task<User> UserAsync(UserRole role = UserRole.Admin, bool totp = true)
    {
        await using var scope = Api.Services.CreateAsyncScope();
        var user = new User
        {
            DisplayName = "Review",
            Email = $"review.{Guid.NewGuid():N}@example.org",
            Role = role,
            EmailVerifiedAt = Clock.Now,
            PasswordHash = await scope.ServiceProvider.GetRequiredService<ApiPasswordHasher>().HashAsync(Password, TestContext.Current.CancellationToken),
            TotpSecretEnc = Protection.CreateProtector("Patika.Totp.v1").Protect(Convert.ToBase64String(Secret)),
            TotpEnabledAt = totp ? Clock.Now : null
        };
        await using var db = fixture.Database.CreateContext();
        db.Users.Add(user);
        await db.SaveChangesAsync(TestContext.Current.CancellationToken);
        return user;
    }

    public async Task<HttpResponseMessage> PasswordAsync(User user) => await AdminBrowser.PostAsync(Browser, "/admin/giris", new() { ["Email"] = user.Email!, ["Password"] = Password });

    public async Task<HttpResponseMessage> LoginAsync(User user)
    {
        using var first = await PasswordAsync(user);
        var html = await first.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        return await AdminBrowser.PostAsync(Browser, "/admin/giris", new() { ["Challenge"] = AdminBrowser.Field(html, "Challenge"), ["Code"] = Code }, html);
    }

    public async Task<AdoptionPost> AdoptionAsync(Guid owner, string content = "A calm cat")
    {
        await using var db = fixture.Database.CreateContext();
        var animal = new Animal { Name = "Pamuk", CreatedBy = owner, Location = new GeoPoint(29, 41), Species = Species.Cat };
        db.Animals.Add(animal);
        var post = new AdoptionPost { AnimalId = animal.Id, CreatedBy = owner, District = "Kadıköy", Description = content, Requirements = "A safe home", ClosesAt = Clock.Now.AddDays(30), State = AdoptionPostState.Pending };
        db.AdoptionPosts.Add(post);
        await db.SaveChangesAsync(TestContext.Current.CancellationToken);
        return post;
    }

    public PatikaDbContext Context() => fixture.Database.CreateContext();

    public async ValueTask DisposeAsync()
    {
        Browser.Dispose();
        await Web.DisposeAsync();
        await Api.DisposeAsync();
    }
}
