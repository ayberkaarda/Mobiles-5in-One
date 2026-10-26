using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Patika.Api.Features.Auth;
using Patika.Api.Security.RateLimiting;
using Patika.Api.Security.Tokens;
using Patika.Api.Tests.Infrastructure;
using Patika.Contracts.Admin;
using Patika.Domain.Entities;
using Patika.SecurityTests.Account;
using Xunit;

namespace Patika.SecurityTests.Admin;

public sealed class StepUpTests(AccountDatabaseFixture database) : IClassFixture<AccountDatabaseFixture>
{
    [Theory]
    [InlineData("missing")]
    [InlineData("expired")]
    [InlineData("reused")]
    [InlineData("other_user")]
    [InlineData("other_session")]
    [InlineData("other_action")]
    [InlineData("other_target")]
    public async Task StepUpIsBoundAndSingleUse(string scenario)
    {
        var ct = TestContext.Current.CancellationToken;
        await using var factory = new PatikaApiFactory();
        await using var db = database.CreateContext();
        var protection = new EphemeralDataProtectionProvider();
        var secret = Encoding.ASCII.GetBytes("12345678901234567890");
        var now = DateTimeOffset.UtcNow;
        var user = new User
        {
            DisplayName = "Review",
            Role = UserRole.Admin,
            TotpEnabledAt = now,
            TotpSecretEnc = protection.CreateProtector("Patika.Totp.v1").Protect(Convert.ToBase64String(secret)),
        };
        db.Users.Add(user);
        await db.SaveChangesAsync(ct);
        var session = Guid.NewGuid();
        ClaimsPrincipal Principal(Guid id, Guid sid) => new(new ClaimsIdentity(
        [new Claim("sub", id.ToString()), new Claim("role", "Admin"), new Claim("sv", "0"), new Claim("sid", sid.ToString())], "Bearer"));
        var principal = Principal(user.Id, session);
        var service = new TotpService(db, protection, factory.Services.GetRequiredService<EmailCodeHasher>(),
            factory.Services.GetRequiredService<IAccessTokenIssuer>(), Options.Create(new JwtSettings()), TimeProvider.System,
            factory.Services.GetRequiredService<TotpRateLimiter>());
        var target = Guid.NewGuid().ToString();
        var issued = Assert.IsType<Ok<StepUpResponse>>(await service.StepUpAsync(principal,
            new StepUpRequest(TotpAlgorithm.Code(secret, now.ToUnixTimeSeconds() / 30), "Review for safety", StepUpActions.Suspend, target), ct)).Value!;
        if (scenario == "expired")
            await db.AdminAccessTokens.Where(x => x.UserId == user.Id).ExecuteUpdateAsync(s => s.SetProperty(x => x.ExpiresAt, now.AddSeconds(-1)), ct);
        if (scenario == "other_user") principal = Principal(Guid.NewGuid(), session);
        if (scenario == "other_session") principal = Principal(user.Id, Guid.NewGuid());
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        if (scenario == "reused") Assert.Equal("Review for safety", await service.ConsumeStepUpAsync(principal, issued.StepUpToken, StepUpActions.Suspend, target, ct));
        var action = scenario == "other_action" ? StepUpActions.RoleChange : StepUpActions.Suspend;
        var expected = scenario == "other_target" ? Guid.NewGuid().ToString() : target;
        Assert.Null(await service.ConsumeStepUpAsync(principal, scenario == "missing" ? null : issued.StepUpToken, action, expected, ct));
        // A refused token stays usable for exactly what it was issued for.
        if (scenario is "other_action" or "other_target")
            Assert.Equal("Review for safety", await service.ConsumeStepUpAsync(principal, issued.StepUpToken, StepUpActions.Suspend, target, ct));
        await tx.CommitAsync(ct);
    }
}
