using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Patika.Api.Email;
using Patika.Api.Features.Account;
using Patika.Api.Features.Admin;
using Patika.Api.Features.Auth;
using Patika.Api.Security.Passwords;
using Patika.Api.Security.Tokens;
using Patika.Api.Tests.Urgent;
using Patika.Contracts.Admin;
using Patika.Contracts.Auth;
using Patika.Domain.Entities;
using Xunit;
using static Patika.Api.Tests.Admin.AdminPersistenceTests;

namespace Patika.Api.Tests.Admin;

/// <summary>Regression tests for the admin review findings: caller re-check, step-up binding, limits and takedowns.</summary>
public sealed class AdminHardeningTests(FeaturePostgisFixture database) : IClassFixture<FeaturePostgisFixture>
{
    private const string Password = "secure-password-42";
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Theory]
    [InlineData("demoted")]
    [InlineData("suspended")]
    [InlineData("deactivated")]
    [InlineData("signed_out")]
    public async Task AdmittedWritesStopWhenTheCallerChangedBeforeTheLock(string change)
    {
        await using var rig = new AdminTestRig(database);
        await using var db = database.CreateContext();
        var caller = rig.User(UserRole.Admin);
        var spare = rig.User(UserRole.Admin);
        var target = rig.User(UserRole.User);
        var suspended = rig.User(UserRole.User);
        suspended.SuspendedUntil = rig.Clock.Now.AddDays(3);
        db.Users.AddRange(caller, spare, target, suspended);
        await db.SaveChangesAsync(Ct);
        var report = await TargetAsync(db, target.Id, "report");
        var urgent = await TargetAsync(db, target.Id, "urgent");
        await db.UrgentPosts.Where(x => x.Id == urgent).ExecuteUpdateAsync(s => s.SetProperty(x => x.HiddenAt, rig.Clock.Now), Ct);
        var (csv, hash) = await CsvAsync(rig, db, caller);

        // Every request passed authorization with the old state, and holds a valid step-up token.
        async Task<DefaultHttpContext> Admitted(string? action, object? stepTarget)
        {
            var http = rig.Http(caller);
            if (action is not null) http.Request.Headers["X-Step-Up"] = await rig.StepAsync(db, caller, action, stepTarget!);
            return http;
        }
        var role = await Admitted(StepUpActions.RoleChange, target.Id);
        var suspend = await Admitted(StepUpActions.Suspend, target.Id);
        var unsuspend = await Admitted(StepUpActions.Unsuspend, suspended.Id);
        var restore = await Admitted(StepUpActions.RestoreUrgent, urgent);
        var commit = await Admitted(StepUpActions.CsvCommit, hash);
        csv(commit, hash);
        var decide = await Admitted(null, null);

        await using (var other = database.CreateContext())
        {
            var row = other.Users.Where(u => u.Id == caller.Id);
            await (change switch
            {
                "demoted" => row.ExecuteUpdateAsync(s => s.SetProperty(u => u.Role, UserRole.User), Ct),
                "suspended" => row.ExecuteUpdateAsync(s => s.SetProperty(u => u.SuspendedUntil, rig.Clock.Now.AddDays(1)), Ct),
                "deactivated" => row.ExecuteUpdateAsync(s => s.SetProperty(u => u.DeactivatedAt, rig.Clock.Now), Ct),
                _ => row.ExecuteUpdateAsync(s => s.SetProperty(u => u.SessionVersion, u => u.SessionVersion + 1), Ct),
            });
        }

        var results = new[]
        {
            await rig.Handlers(db).RoleAsync(role, target.Id, new AdminRoleRequest("Moderator"), Ct),
            await rig.Handlers(db).SuspendAsync(suspend, target.Id, new AdminSuspendRequest(null, "Reviewed for safety"), Ct),
            await rig.Handlers(db).UnsuspendAsync(unsuspend, suspended.Id, new AdminUnsuspendRequest("Reviewed for safety"), Ct),
            await rig.Handlers(db).DecideAsync(restore, new AdminDecisionRequest("urgent", urgent, "Restored", null), Ct),
            await rig.Handlers(db).DecideAsync(decide, new AdminDecisionRequest("report", report, "Approved", "Reviewed for safety"), Ct),
            await rig.Handlers(db).CsvAsync(commit, true, Ct),
        };
        foreach (var result in results)
        {
            Assert.Equal(403, Status(result));
            Assert.Equal("admin_access_revoked", Code(result));
        }

        await using var check = database.CreateContext();
        var stored = await check.Users.AsNoTracking().SingleAsync(u => u.Id == target.Id, Ct);
        Assert.Equal(UserRole.User, stored.Role);
        Assert.Null(stored.SuspendedUntil);
        Assert.NotNull((await check.Users.AsNoTracking().SingleAsync(u => u.Id == suspended.Id, Ct)).SuspendedUntil);
        Assert.NotNull((await check.UrgentPosts.IgnoreQueryFilters().AsNoTracking().SingleAsync(x => x.Id == urgent, Ct)).HiddenAt);
        Assert.Equal(ReportState.Pending, (await check.Reports.AsNoTracking().SingleAsync(x => x.Id == report, Ct)).State);
        Assert.False(await check.CarePlaceImports.AnyAsync(x => x.FileHash == hash, Ct));
        Assert.False(await check.ModerationDecisions.AnyAsync(x => x.ReviewerId == caller.Id, Ct));
        Assert.False(await check.AuditLogs.AnyAsync(x => x.ActorId == caller.Id && !x.Action.StartsWith("totp."), Ct));
        Assert.False(await check.AdminAccessTokens.AnyAsync(x => x.UserId == caller.Id && x.UsedAt != null, Ct));
    }

    [Fact]
    public async Task ACallerDemotedWhileWaitingForTheAdvisoryLockCannotWrite()
    {
        await using var rig = new AdminTestRig(database);
        await using var db = database.CreateContext();
        var caller = rig.User(UserRole.Admin);
        var spare = rig.User(UserRole.Admin);
        var target = rig.User(UserRole.User);
        db.Users.AddRange(caller, spare, target);
        await db.SaveChangesAsync(Ct);
        var http = rig.Http(caller);
        http.Request.Headers["X-Step-Up"] = await rig.StepAsync(db, caller, StepUpActions.RoleChange, target.Id);

        await using var holder = database.CreateContext();
        await holder.Database.OpenConnectionAsync(Ct);
        await holder.Database.ExecuteSqlAsync($"SELECT pg_advisory_lock({AdminWriteLock.Key})", Ct);
        await using var waiting = database.CreateContext();
        var request = rig.Handlers(waiting).RoleAsync(http, target.Id, new AdminRoleRequest("Moderator"), Ct);
        await Task.Delay(500, Ct);
        Assert.False(request.IsCompleted);
        await using (var other = database.CreateContext())
            await other.Users.Where(u => u.Id == caller.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.Role, UserRole.User), Ct);
        await holder.Database.ExecuteSqlAsync($"SELECT pg_advisory_unlock({AdminWriteLock.Key})", Ct);

        var result = await request;
        Assert.Equal(403, Status(result));
        Assert.Equal("admin_access_revoked", Code(result));
        await using var check = database.CreateContext();
        Assert.Equal(UserRole.User, (await check.Users.AsNoTracking().SingleAsync(u => u.Id == target.Id, Ct)).Role);
        Assert.False(await check.AuditLogs.AnyAsync(x => x.ActorId == caller.Id && x.Action == "user.role", Ct));
    }

    [Fact]
    public async Task ConcurrentReciprocalDemotionsNeverLeaveZeroActiveAdmins()
    {
        await using var rig = new AdminTestRig(database);
        await using (var reset = database.CreateContext())
            await reset.Users.Where(u => u.Role == UserRole.Admin).ExecuteUpdateAsync(s => s.SetProperty(u => u.Role, UserRole.User), Ct);
        var first = rig.User(UserRole.Admin);
        var second = rig.User(UserRole.Admin);
        DefaultHttpContext firstHttp, secondHttp;
        await using (var setup = database.CreateContext())
        {
            setup.Users.AddRange(first, second);
            await setup.SaveChangesAsync(Ct);
            firstHttp = rig.Http(first);
            firstHttp.Request.Headers["X-Step-Up"] = await rig.StepAsync(setup, first, StepUpActions.RoleChange, second.Id);
            secondHttp = rig.Http(second);
            secondHttp.Request.Headers["X-Step-Up"] = await rig.StepAsync(setup, second, StepUpActions.RoleChange, first.Id);
        }

        await using var a = database.CreateContext();
        await using var b = database.CreateContext();
        var results = await Task.WhenAll(
            Task.Run(() => rig.Handlers(a).RoleAsync(firstHttp, second.Id, new AdminRoleRequest("User"), Ct), Ct),
            Task.Run(() => rig.Handlers(b).RoleAsync(secondHttp, first.Id, new AdminRoleRequest("User"), Ct), Ct));

        Assert.Equal(new int?[] { 204, 403 }, results.Select(Status).Order().ToArray());
        await using var check = database.CreateContext();
        Assert.Equal(1, await AdminWriteLock.ActiveAdminsAsync(check, rig.Clock.Now, Ct));
    }

    [Fact]
    public async Task StepUpTokenOnlyAuthorizesItsActionAndTarget()
    {
        await using var rig = new AdminTestRig(database);
        await using var db = database.CreateContext();
        var admin = rig.User(UserRole.Admin);
        var x = rig.User(UserRole.User);
        var y = rig.User(UserRole.User);
        db.Users.AddRange(admin, x, y);
        await db.SaveChangesAsync(Ct);
        var http = rig.Http(admin);
        http.Request.Headers["X-Step-Up"] = await rig.StepAsync(db, admin, StepUpActions.Suspend, x.Id);
        var suspend = new AdminSuspendRequest(null, "Reviewed for safety");

        // Token for action Suspend refused on RoleChange; token for target X refused on Y.
        Assert.Equal(403, Status(await rig.Handlers(db).RoleAsync(http, x.Id, new AdminRoleRequest("Moderator"), Ct)));
        Assert.Equal(403, Status(await rig.Handlers(db).SuspendAsync(http, y.Id, suspend, Ct)));
        Assert.Null((await db.Users.AsNoTracking().SingleAsync(u => u.Id == y.Id, Ct)).SuspendedUntil);
        Assert.Equal(204, Status(await rig.Handlers(db).SuspendAsync(http, x.Id, suspend, Ct)));

        var issued = await db.AdminAccessTokens.AsNoTracking().Where(t => t.UserId == admin.Id && t.Purpose == "step_up").SingleAsync(Ct);
        Assert.Equal(StepUpActions.Suspend, issued.Action);
        Assert.Equal(x.Id.ToString("D"), issued.TargetId);
        var invalid = await rig.Totp(db).StepUpAsync(rig.Http(admin).User, new StepUpRequest(rig.Code, "Review for safety", "Delete", x.Id.ToString()), Ct);
        Assert.Equal(400, Status(invalid));
    }

    [Fact]
    public async Task UnsuspendIsAStepUpActionAndSuspensionsCannotBeShortened()
    {
        await using var rig = new AdminTestRig(database);
        await using var db = database.CreateContext();
        var admin = rig.User(UserRole.Admin);
        var target = rig.User(UserRole.User);
        db.Users.AddRange(admin, target);
        await db.SaveChangesAsync(Ct);
        var h = rig.Handlers(db);
        var http = rig.Http(admin);
        var reason = "Reviewed for safety";

        Assert.Equal(400, Status(await h.SuspendAsync(http, target.Id, new AdminSuspendRequest(rig.Clock.Now.AddMinutes(-1), reason), Ct)));
        http.Request.Headers["X-Step-Up"] = await rig.StepAsync(db, admin, StepUpActions.Unsuspend, target.Id);
        Assert.Equal(409, Status(await h.UnsuspendAsync(http, target.Id, new AdminUnsuspendRequest(reason), Ct)));

        var until = rig.Clock.Now.AddDays(10);
        http.Request.Headers["X-Step-Up"] = await rig.StepAsync(db, admin, StepUpActions.Suspend, target.Id);
        Assert.Equal(204, Status(await h.SuspendAsync(http, target.Id, new AdminSuspendRequest(until, reason), Ct)));
        http.Request.Headers["X-Step-Up"] = await rig.StepAsync(db, admin, StepUpActions.Suspend, target.Id);
        Assert.Equal(400, Status(await h.SuspendAsync(http, target.Id, new AdminSuspendRequest(rig.Clock.Now.AddDays(1), reason), Ct)));
        Assert.Equal(until, (await db.Users.AsNoTracking().SingleAsync(u => u.Id == target.Id, Ct)).SuspendedUntil);

        // A token minted for suspend does not unsuspend.
        Assert.Equal(403, Status(await h.UnsuspendAsync(http, target.Id, new AdminUnsuspendRequest(reason), Ct)));
        http.Request.Headers["X-Step-Up"] = await rig.StepAsync(db, admin, StepUpActions.Unsuspend, target.Id);
        Assert.Equal(400, Status(await h.UnsuspendAsync(http, target.Id, new AdminUnsuspendRequest("short"), Ct)));
        Assert.Equal(204, Status(await h.UnsuspendAsync(http, target.Id, new AdminUnsuspendRequest(reason), Ct)));
        Assert.Null((await db.Users.AsNoTracking().SingleAsync(u => u.Id == target.Id, Ct)).SuspendedUntil);
        var audit = await db.AuditLogs.AsNoTracking().SingleAsync(x => x.TargetId == target.Id && x.Action == "user.unsuspend", Ct);
        Assert.Equal(admin.Id, audit.ActorId);
        Assert.Contains("Review for safety", audit.DetailsJson);
    }

    [Theory]
    [InlineData("adoption")]
    [InlineData("photo")]
    public async Task PublishedContentCanBeTakenDownWithAReason(string type)
    {
        await using var rig = new AdminTestRig(database);
        await using var db = database.CreateContext();
        var moderator = rig.User();
        db.Users.Add(moderator);
        await db.SaveChangesAsync(Ct);
        var target = await TargetAsync(db, moderator.Id, type);
        var h = rig.Handlers(db);
        Assert.Equal(204, Status(await h.DecideAsync(rig.Http(moderator), new AdminDecisionRequest(type, target, "Approved", null), Ct)));
        Assert.Equal(409, Status(await h.DecideAsync(rig.Http(moderator), new AdminDecisionRequest(type, target, "Approved", null), Ct)));
        Assert.Equal(400, Status(await h.DecideAsync(rig.Http(moderator), new AdminDecisionRequest(type, target, "Rejected", null), Ct)));
        Assert.Equal(204, Status(await h.DecideAsync(rig.Http(moderator), new AdminDecisionRequest(type, target, "Rejected", "Reported and confirmed abusive"), Ct)));
        Assert.Equal(409, Status(await h.DecideAsync(rig.Http(moderator), new AdminDecisionRequest(type, target, "Approved", null), Ct)));

        await using var check = database.CreateContext();
        if (type == "adoption") Assert.Equal(AdoptionPostState.Rejected, (await check.AdoptionPosts.FindAsync([target], Ct))!.State);
        else Assert.Equal(ModerationState.Rejected, (await check.AnimalPhotos.FindAsync([target], Ct))!.ModerationState);
        var audits = await check.AuditLogs.AsNoTracking().Where(x => x.TargetId == target).Select(x => x.DetailsJson).ToListAsync(Ct);
        Assert.Contains(audits, x => x!.Contains("Reported and confirmed abusive") && x.Contains("previous"));
        Assert.Equal(2, await check.ModerationDecisions.CountAsync(x => x.TargetId == target, Ct));
    }

    [Fact]
    public async Task TheLastActiveAdminCannotDeleteTheAccount()
    {
        await using var rig = new AdminTestRig(database);
        await using (var reset = database.CreateContext())
            await reset.Users.Where(u => u.Role == UserRole.Admin).ExecuteUpdateAsync(s => s.SetProperty(u => u.Role, UserRole.User), Ct);
        var admin = rig.User(UserRole.Admin);
        var suspendedAdmin = rig.User(UserRole.Admin);
        suspendedAdmin.SuspendedUntil = rig.Clock.Now.AddDays(1);
        await using (var setup = database.CreateContext())
        {
            setup.Users.AddRange(admin, suspendedAdmin);
            await setup.SaveChangesAsync(Ct);
        }

        // A suspended admin does not count, so the only active admin is refused.
        var refused = await DeleteAsync(rig, admin);
        var problem = Assert.IsType<ProblemHttpResult>(refused);
        Assert.Equal(409, problem.StatusCode);
        Assert.Equal("last_admin_protected", problem.ProblemDetails.Extensions["code"]?.ToString());
        await using (var check = database.CreateContext())
        {
            Assert.Null((await check.Users.AsNoTracking().SingleAsync(u => u.Id == admin.Id, Ct)).DeactivatedAt);
            Assert.False(await check.DeletionRequests.AnyAsync(r => r.UserId == admin.Id, Ct));
        }

        await using (var promote = database.CreateContext())
            await promote.Users.Where(u => u.Id == suspendedAdmin.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.SuspendedUntil, (DateTimeOffset?)null), Ct);
        Assert.Equal(202, Status(await DeleteAsync(rig, admin)));
    }

    [Fact]
    public async Task TotpLimitIsPerUserSoAdminsBehindOneAddressDoNotShareIt()
    {
        await using var rig = new AdminTestRig(database);
        // Issued tokens carry the test clock; start in the past so every valid code (30 s apart) stays before real time.
        rig.Clock.Now = rig.Clock.Now.AddMinutes(-6);
        var hasher = rig.Factory.Services.GetRequiredService<IPasswordHasher>();
        var first = rig.User(UserRole.Admin);
        var second = rig.User(UserRole.Admin);
        var target = rig.User(UserRole.User);
        first.PasswordHash = await hasher.HashAsync(Password, Ct);
        second.PasswordHash = await hasher.HashAsync(Password, Ct);
        await using (var db = database.CreateContext())
        {
            db.Users.AddRange(first, second, target);
            await db.SaveChangesAsync(Ct);
        }

        // Every call comes from the same address, like the Web BFF calling the API server-side.
        using var client = rig.Factory.CreateApiClient("198.51.100.20");
        var firstToken = await SignInAsync(rig, client, first);
        for (var i = 0; i < 5; i++)
        {
            using var response = await StepUpAsync(rig, client, firstToken, true, target.Id);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }

        // Burn the rest of the first admin's budget (20 per 15 minutes, the MFA completion counted too).
        for (var i = 0; i < 14; i++)
        {
            using var response = await StepUpAsync(rig, client, firstToken, false, target.Id);
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        }
        using (var limited = await StepUpAsync(rig, client, firstToken, true, target.Id))
        {
            Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
            Assert.NotNull(limited.Headers.RetryAfter);
        }

        var secondToken = await SignInAsync(rig, client, second);
        using var unaffected = await StepUpAsync(rig, client, secondToken, true, target.Id);
        Assert.Equal(HttpStatusCode.OK, unaffected.StatusCode);
    }

    [Fact]
    public async Task LockedTotpAttemptsAndRefusedMfaChallengesAreAudited()
    {
        await using var rig = new AdminTestRig(database);
        var user = rig.User(UserRole.Admin);
        user.PasswordHash = await rig.Factory.Services.GetRequiredService<IPasswordHasher>().HashAsync(Password, Ct);
        await using (var db = database.CreateContext())
        {
            db.Users.Add(user);
            await db.SaveChangesAsync(Ct);
        }

        using var login = await rig.SendAsync("/v1/auth/login", new LoginRequest(user.Email!, Password));
        var challenge = (await login.Content.ReadFromJsonAsync<MfaRequiredResponse>(Ct))!;
        using (var completed = await rig.SendAsync("/v1/auth/mfa", new MfaRequest(challenge.MfaToken, rig.Code)))
            Assert.Equal(HttpStatusCode.OK, completed.StatusCode);
        rig.Clock.Now = rig.Clock.Now.AddSeconds(30);
        using (var reused = await rig.SendAsync("/v1/auth/mfa", new MfaRequest(challenge.MfaToken, rig.Code)))
            Assert.Equal(HttpStatusCode.Unauthorized, reused.StatusCode);

        await using (var db = database.CreateContext())
        {
            await db.Users.Where(u => u.Id == user.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.TotpLockedUntil, rig.Clock.Now.AddMinutes(10)), Ct);
            var locked = await rig.Totp(db).StepUpAsync(rig.Http(user).User,
                new StepUpRequest(rig.Code, "Review for safety", StepUpActions.Suspend, Guid.NewGuid().ToString()), Ct);
            Assert.Equal(403, Status(locked));
        }

        await using var check = database.CreateContext();
        var actions = await check.AuditLogs.AsNoTracking().Where(x => x.ActorId == user.Id).Select(x => x.Action).ToListAsync(Ct);
        Assert.Contains("totp.mfa_rejected", actions);
        Assert.Contains("totp.failure_locked", actions);
        Assert.Equal(0, (await check.Users.AsNoTracking().SingleAsync(u => u.Id == user.Id, Ct)).TotpFailedAttempts);
    }

    private static async Task<string> SignInAsync(AdminTestRig rig, HttpClient client, User user)
    {
        client.DefaultRequestHeaders.Authorization = null;
        using var login = await client.PostAsJsonAsync("/v1/auth/login", new LoginRequest(user.Email!, Password), Ct);
        Assert.Equal(HttpStatusCode.Accepted, login.StatusCode);
        var challenge = (await login.Content.ReadFromJsonAsync<MfaRequiredResponse>(Ct))!;
        rig.Clock.Now = rig.Clock.Now.AddSeconds(30);
        using var completed = await client.PostAsJsonAsync("/v1/auth/mfa", new MfaRequest(challenge.MfaToken, rig.Code), Ct);
        Assert.Equal(HttpStatusCode.OK, completed.StatusCode);
        return (await completed.Content.ReadFromJsonAsync<TokenResponse>(Ct))!.AccessToken;
    }

    private static async Task<HttpResponseMessage> StepUpAsync(AdminTestRig rig, HttpClient client, string bearer, bool valid, Guid target)
    {
        // Each accepted code needs a later TOTP step; a wrong code is not a number at all.
        if (valid) rig.Clock.Now = rig.Clock.Now.AddSeconds(30);
        var code = valid ? rig.Code : "wrong!";
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        return await client.PostAsJsonAsync("/v1/admin/step-up",
            new StepUpRequest(code, "Review for safety", StepUpActions.Suspend, target.ToString()), Ct);
    }

    private static async Task<(Action<DefaultHttpContext, string?> Form, string Hash)> CsvAsync(AdminTestRig rig, Patika.Infrastructure.Persistence.PatikaDbContext db, User admin)
    {
        var csv = $"name,kind,latitude,longitude,address,phone,open24h,district\nClinic {Guid.NewGuid():N},Vet,41,29,Address,+90 212 123 45 67,true,Kadıköy\n";
        var bytes = System.Text.Encoding.UTF8.GetBytes(csv);
        void Form(DefaultHttpContext http, string? hash)
        {
            http.Request.ContentType = "multipart/form-data; boundary=test";
            var files = new FormFileCollection { new FormFile(new MemoryStream(bytes), 0, bytes.Length, "file", "places.csv") };
            http.Request.Form = new FormCollection(new Dictionary<string, Microsoft.Extensions.Primitives.StringValues> { ["previewHash"] = hash }, files);
        }
        var preview = rig.Http(admin);
        Form(preview, null);
        var hash = Assert.IsType<Ok<CarePlacePreview>>(await rig.Handlers(db).CsvAsync(preview, false, Ct)).Value!.PreviewHash;
        return (Form, hash);
    }

    private static async Task<IResult> DeleteAsync(AdminTestRig rig, User user)
    {
        await using var scope = rig.Factory.Services.CreateAsyncScope();
        var services = scope.ServiceProvider;
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
        [
            new Claim(PatikaClaims.Subject, user.Id.ToString()), new Claim(PatikaClaims.Role, user.Role.ToString()),
            new Claim(PatikaClaims.AuthMethod, PatikaClaims.PasswordMethod), new Claim(PatikaClaims.AuthMethod, "mfa"),
            new Claim(PatikaClaims.AuthTime, rig.Clock.Now.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture)),
        ], "Bearer", PatikaClaims.Subject, PatikaClaims.Role));
        var http = new DefaultHttpContext { User = principal, RequestServices = services };
        return await AccountEndpoints.DeleteMeAsync(http, services.GetRequiredService<IAuthStore>(),
            services.GetRequiredService<IAccountDeletionStore>(), services.GetRequiredService<IAuthorizationService>(),
            services.GetRequiredService<IEmailSender>(), rig.Clock, services.GetRequiredService<ILoggerFactory>(), Ct);
    }

    private static string? Code(IResult result) => Assert.IsType<ProblemHttpResult>(result).ProblemDetails.Extensions["code"]?.ToString();
}
