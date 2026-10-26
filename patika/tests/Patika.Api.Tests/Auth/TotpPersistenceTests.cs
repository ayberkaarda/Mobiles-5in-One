using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Patika.Api.Features.Auth;
using Patika.Api.Tests.Admin;
using Patika.Api.Tests.Urgent;
using Patika.Contracts.Auth;
using Patika.Domain.Entities;
using Xunit;

namespace Patika.Api.Tests.Auth;

public sealed class TotpPersistenceTests(FeaturePostgisFixture database) : IClassFixture<FeaturePostgisFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task FiveFailuresPersistAcrossContextsAndLockCorrectCodesForFifteenMinutes()
    {
        await using var rig = new AdminTestRig(database);
        var user = rig.User();
        await using (var db = database.CreateContext()) { db.Users.Add(user); await db.SaveChangesAsync(Ct); }
        for (var attempt = 0; attempt < 5; attempt++)
        {
            await using var db = database.CreateContext();
            await using var tx = await db.Database.BeginTransactionAsync(Ct);
            var service = rig.Totp(db);
            var locked = (await service.LockUserAsync(user.Id, Ct))!;
            Assert.False(await service.VerifyAsync(locked, "wrong", null, false, Ct));
            await db.SaveChangesAsync(Ct);
            await tx.CommitAsync(Ct);
        }
        await using (var db = database.CreateContext())
        {
            var stored = await db.Users.SingleAsync(x => x.Id == user.Id, Ct);
            Assert.Equal(5, stored.TotpFailedAttempts);
            Assert.Equal(rig.Clock.Now.AddMinutes(15), stored.TotpLockedUntil);
            Assert.False(await rig.Totp(db).VerifyAsync(stored, rig.Code, null, false, Ct));
            Assert.Single(await db.AuditLogs.Where(x => x.ActorId == user.Id && x.Action == "totp.failure_lockout").ToListAsync(Ct));
            rig.Clock.Now = rig.Clock.Now.AddMinutes(16);
            Assert.True(await rig.Totp(db).VerifyAsync(stored, rig.Code, null, false, Ct));
            await db.SaveChangesAsync(Ct);
        }
        await using (var db = database.CreateContext())
        {
            var stored = await db.Users.SingleAsync(x => x.Id == user.Id, Ct);
            Assert.False(await rig.Totp(db).VerifyAsync(stored, rig.Code, null, false, Ct));
        }
    }

    [Fact]
    public async Task ConfirmationReturnsTenHashedRecoveryCodesAndEachIsSingleUse()
    {
        await using var rig = new AdminTestRig(database);
        await using var db = database.CreateContext();
        var user = rig.User(enabled: false);
        db.Users.Add(user);
        await db.SaveChangesAsync(Ct);
        var service = rig.Totp(db);
        var confirmed = Assert.IsType<Ok<TotpConfirmResponse>>(await service.ConfirmAsync(rig.Http(user).User, rig.Code, Ct)).Value!;
        Assert.Equal(10, confirmed.RecoveryCodes.Count);
        Assert.Equal(10, await db.TotpRecoveryCodes.CountAsync(x => x.UserId == user.Id, Ct));
        var auth = (await new EfAuthStore(db).FindUserByIdAsync(user.Id, Ct))!;
        var challenge = Assert.IsType<Accepted<MfaRequiredResponse>>(await service.StartMfaAsync(auth, null, "pwd", Ct)).Value!;
        // Typed in lowercase, the code is still recognised.
        var request = new MfaRequest(challenge.MfaToken, RecoveryCode: confirmed.RecoveryCodes[0].ToLowerInvariant());
        Assert.IsType<Ok<TokenResponse>>(await service.CompleteMfaAsync(request, Ct));
        var second = Assert.IsType<Accepted<MfaRequiredResponse>>(await service.StartMfaAsync(auth, null, "pwd", Ct)).Value!;
        Assert.Equal(403, Status(await service.CompleteMfaAsync(request with { MfaToken = second.MfaToken }, Ct)));
        Assert.Equal(1, await db.TotpRecoveryCodes.CountAsync(x => x.UserId == user.Id && x.UsedAt != null, Ct));
    }

    [Fact]
    public async Task MfaChallengeExpiresAndSuccessfulUseCannotBeRepeated()
    {
        await using var rig = new AdminTestRig(database);
        await using var db = database.CreateContext();
        var user = rig.User();
        db.Users.Add(user);
        await db.SaveChangesAsync(Ct);
        var auth = (await new EfAuthStore(db).FindUserByIdAsync(user.Id, Ct))!;
        var service = rig.Totp(db);
        var expired = Assert.IsType<Accepted<MfaRequiredResponse>>(await service.StartMfaAsync(auth, null, "pwd", Ct)).Value!;
        rig.Clock.Now = rig.Clock.Now.AddMinutes(5);
        Assert.Equal(401, Status(await service.CompleteMfaAsync(new MfaRequest(expired.MfaToken, rig.Code), Ct)));
        var fresh = Assert.IsType<Accepted<MfaRequiredResponse>>(await service.StartMfaAsync(auth, null, "pwd", Ct)).Value!;
        var request = new MfaRequest(fresh.MfaToken, rig.Code);
        Assert.IsType<Ok<TokenResponse>>(await service.CompleteMfaAsync(request, Ct));
        Assert.Equal(401, Status(await service.CompleteMfaAsync(request, Ct)));
    }

    [Fact]
    public async Task EnrolmentRequiresRecentSignInAndCannotOverwriteAnEnabledSecret()
    {
        await using var rig = new AdminTestRig(database);
        await using var db = database.CreateContext();
        var user = rig.User(UserRole.User, enabled: false);
        db.Users.Add(user);
        await db.SaveChangesAsync(Ct);
        var http = rig.Http(user);
        rig.Clock.Now = rig.Clock.Now.AddMinutes(11);
        Assert.Equal(403, Status(await rig.Totp(db).EnrolAsync(http.User, Ct)));
        var enrol = Assert.IsType<Ok<TotpEnrolResponse>>(await rig.Totp(db).EnrolAsync(rig.Http(user).User, Ct)).Value!;
        Assert.Equal(32, enrol.Secret.Length);
        Assert.Contains("issuer=Patika", enrol.OtpauthUri);
        Assert.DoesNotContain(user.Email!, enrol.OtpauthUri);
        user.TotpEnabledAt = rig.Clock.Now;
        await db.SaveChangesAsync(Ct);
        Assert.Equal(409, Status(await rig.Totp(db).EnrolAsync(rig.Http(user).User, Ct)));
    }

    internal static int? Status(IResult result) => (result as IStatusCodeHttpResult)?.StatusCode;
}
