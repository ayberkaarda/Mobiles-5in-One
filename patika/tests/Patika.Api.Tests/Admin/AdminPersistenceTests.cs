using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Patika.Api.Features.Urgent;
using Patika.Api.Tests.Urgent;
using Patika.Contracts.Admin;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;
using Xunit;

namespace Patika.Api.Tests.Admin;

public sealed class AdminPersistenceTests(FeaturePostgisFixture database) : IClassFixture<FeaturePostgisFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Theory]
    [InlineData("adoption", "Approved")]
    [InlineData("adoption", "Rejected")]
    [InlineData("photo", "Approved")]
    [InlineData("photo", "Rejected")]
    [InlineData("report", "Approved")]
    [InlineData("report", "Rejected")]
    [InlineData("urgent", "Hidden")]
    public async Task DecisionChangesStateAndWritesBothRecordsThenRejectsRepeat(string type, string decision)
    {
        await using var rig = new AdminTestRig(database);
        await using var db = database.CreateContext();
        var moderator = rig.User();
        db.Users.Add(moderator);
        await db.SaveChangesAsync(Ct);
        var target = await TargetAsync(db, moderator.Id, type);
        var request = new AdminDecisionRequest(type, target, decision, "Reviewed for safety");
        var result = await rig.Handlers(db).DecideAsync(rig.Http(moderator), request, Ct);
        Assert.Equal(204, Status(result));
        Assert.Equal(409, Status(await rig.Handlers(db).DecideAsync(rig.Http(moderator), request, Ct)));
        Assert.Single(await db.ModerationDecisions.Where(x => x.TargetId == target).ToListAsync(Ct));
        Assert.Single(await db.AuditLogs.Where(x => x.TargetId == target).ToListAsync(Ct));
        if (type == "adoption") Assert.Equal(decision == "Approved" ? AdoptionPostState.Published : AdoptionPostState.Rejected, (await db.AdoptionPosts.FindAsync([target], Ct))!.State);
        if (type == "photo") Assert.Equal(decision == "Approved" ? ModerationState.Approved : ModerationState.Rejected, (await db.AnimalPhotos.FindAsync([target], Ct))!.ModerationState);
        if (type == "report") Assert.Equal(decision == "Approved" ? ReportState.Reviewed : ReportState.Dismissed, (await db.Reports.FindAsync([target], Ct))!.State);
    }

    [Fact]
    public async Task HiddenUrgentAppearsInQueueButNotPublicGetAndRestoreConsumesStepUp()
    {
        await using var rig = new AdminTestRig(database);
        await using var db = database.CreateContext();
        var moderator = rig.User();
        db.Users.Add(moderator);
        await db.SaveChangesAsync(Ct);
        var target = await TargetAsync(db, moderator.Id, "urgent");
        var h = rig.Handlers(db);
        await h.DecideAsync(rig.Http(moderator), new AdminDecisionRequest("urgent", target, "Hidden", "Reviewed for safety"), Ct);
        var page = Assert.IsType<Ok<AdminPage<AdminQueueItem>>>(await h.QueueAsync("urgent", null, Ct)).Value!;
        Assert.True(Assert.Single(page.Items, p => p.Id == target).Hidden);
        Assert.Equal(404, Status(await UrgentEndpoints.GetAsync(target, new EfUrgentStore(db), Ct)));
        var restore = new AdminDecisionRequest("urgent", target, "Restored", null);
        Assert.Equal(403, Status(await h.DecideAsync(rig.Http(moderator), restore, Ct)));
        var http = rig.Http(moderator);
        http.Request.Headers["X-Step-Up"] = await rig.StepAsync(db, moderator);
        Assert.Equal(204, Status(await h.DecideAsync(http, restore, Ct)));
        var audit = await db.AuditLogs.OrderByDescending(x => x.CreatedAt).FirstAsync(x => x.TargetId == target, Ct);
        Assert.Contains("Review for safety", audit.DetailsJson);
        Assert.NotNull(await new EfUrgentStore(db).FindAsync(target, Ct));
    }

    [Fact]
    public async Task FailureAfterSavingRollsBackEntityDecisionAndAuditTogether()
    {
        await using var rig = new AdminTestRig(database);
        Guid target;
        var moderator = rig.User();
        await using (var setup = database.CreateContext())
        {
            setup.Users.Add(moderator);
            await setup.SaveChangesAsync(Ct);
            target = await TargetAsync(setup, moderator.Id, "report");
        }
        await using (var failing = new PatikaDbContext(new DbContextOptionsBuilder<PatikaDbContext>()
            .UseNpgsql(database.ConnectionString, p => p.UseNetTopologySuite()).AddInterceptors(new FailAfterSave()).Options))
        {
            await Assert.ThrowsAsync<InvalidOperationException>(() => rig.Handlers(failing).DecideAsync(rig.Http(moderator),
                new AdminDecisionRequest("report", target, "Approved", "Reviewed for safety"), Ct));
        }
        await using var check = database.CreateContext();
        Assert.Equal(ReportState.Pending, (await check.Reports.FindAsync([target], Ct))!.State);
        Assert.False(await check.ModerationDecisions.AnyAsync(x => x.TargetId == target, Ct));
        Assert.False(await check.AuditLogs.AnyAsync(x => x.TargetId == target, Ct));
    }

    [Fact]
    public async Task SearchIsExactOrIdPrefixAndRoleChangesEnforceTargetMfaAndOwnProtection()
    {
        await using var rig = new AdminTestRig(database);
        await using var db = database.CreateContext();
        var admin = rig.User(UserRole.Admin);
        var target = rig.User(UserRole.User, false);
        db.Users.AddRange(admin, target);
        await db.SaveChangesAsync(Ct);
        var h = rig.Handlers(db);
        Assert.Equal(409, Status(await h.RoleAsync(rig.Http(admin), admin.Id, new AdminRoleRequest("User"), Ct)));
        var http = rig.Http(admin);
        http.Request.Headers["X-Step-Up"] = await rig.StepAsync(db, admin);
        Assert.Equal(409, Status(await h.RoleAsync(http, target.Id, new AdminRoleRequest("Moderator"), Ct)));
        var exact = Assert.IsType<Ok<List<AdminUser>>>(await h.UsersAsync(target.Email, Ct)).Value!;
        Assert.Single(exact);
        Assert.DoesNotContain(target.Email!, exact[0].Email!);
        var fragment = target.Email![1..];
        Assert.Empty(Assert.IsType<Ok<List<AdminUser>>>(await h.UsersAsync(fragment, Ct)).Value!);
        target.TotpEnabledAt = rig.Clock.Now;
        await db.SaveChangesAsync(Ct);
        Assert.Equal(204, Status(await h.RoleAsync(http, target.Id, new AdminRoleRequest("Moderator"), Ct)));
        Assert.Equal(1, target.SessionVersion);
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("expired")]
    [InlineData("other_user")]
    [InlineData("other_session")]
    [InlineData("reused")]
    public async Task SensitiveActionsRefuseInvalidStepUp(string scenario)
    {
        await using var rig = new AdminTestRig(database);
        await using var db = database.CreateContext();
        var admin = rig.User(UserRole.Admin);
        var other = rig.User(UserRole.Admin);
        var target = rig.User(UserRole.User);
        db.Users.AddRange(admin, other, target);
        await db.SaveChangesAsync(Ct);
        var http = rig.Http(admin);
        if (scenario != "missing")
        {
            var code = await rig.StepAsync(db, scenario == "other_user" ? other : admin,
                scenario == "other_session" ? Guid.NewGuid() : null);
            http.Request.Headers["X-Step-Up"] = code;
        }
        if (scenario == "expired") rig.Clock.Now = rig.Clock.Now.AddMinutes(5);
        var request = new AdminSuspendRequest(null, "Reviewed for safety");
        if (scenario == "reused") Assert.Equal(204, Status(await rig.Handlers(db).SuspendAsync(http, target.Id, request, Ct)));
        Assert.Equal(403, Status(await rig.Handlers(db).SuspendAsync(http, target.Id, request, Ct)));
    }

    [Fact]
    public async Task AnAdmittedRequestCannotRemoveTheLastAdminAfterTheCallerIsDemoted()
    {
        await using var rig = new AdminTestRig(database);
        await using var db = database.CreateContext();
        await db.Users.Where(u => u.Role == UserRole.Admin).ExecuteUpdateAsync(s => s.SetProperty(u => u.Role, UserRole.User), Ct);
        var caller = rig.User(UserRole.Admin);
        var lastAdmin = rig.User(UserRole.Admin);
        db.Users.AddRange(caller, lastAdmin);
        await db.SaveChangesAsync(Ct);
        var admitted = rig.Http(caller);
        admitted.Request.Headers["X-Step-Up"] = await rig.StepAsync(db, caller);
        caller.Role = UserRole.User;
        await db.SaveChangesAsync(Ct);
        var response = await rig.Handlers(db).RoleAsync(admitted, lastAdmin.Id, new AdminRoleRequest("User"), Ct);
        Assert.Equal(409, Status(response));
        Assert.Contains("last_admin_protected", Assert.IsType<ProblemHttpResult>(response).ProblemDetails.Extensions["code"]!.ToString());
        Assert.Equal(UserRole.Admin, (await db.Users.FindAsync([lastAdmin.Id], Ct))!.Role);
    }

    [Fact]
    public async Task CsvPreviewDoesNotWriteAndCommitIsIdempotent()
    {
        await using var rig = new AdminTestRig(database);
        await using var db = database.CreateContext();
        var admin = rig.User(UserRole.Admin);
        db.Users.Add(admin);
        await db.SaveChangesAsync(Ct);
        var before = await db.CarePlaces.CountAsync(Ct);
        var name = $"Clinic {Guid.NewGuid():N}";
        var csv = $"name,kind,latitude,longitude,address,phone,open24h,district\n{name},Vet,41,29,Address,+90 212 123 45 67,true,Kadıköy\n";
        var http = rig.Http(admin);
        var bytes = System.Text.Encoding.UTF8.GetBytes(csv);
        void Form(string? hash = null)
        {
            http.Request.ContentType = "multipart/form-data; boundary=test";
            var files = new FormFileCollection { new FormFile(new MemoryStream(bytes), 0, bytes.Length, "file", "places.csv") };
            http.Request.Form = new FormCollection(new Dictionary<string, Microsoft.Extensions.Primitives.StringValues> { ["previewHash"] = hash }, files);
        }
        Form();
        var preview = Assert.IsType<Ok<CarePlacePreview>>(await rig.Handlers(db).CsvAsync(http, false, Ct)).Value!;
        Assert.Equal(before, await db.CarePlaces.CountAsync(Ct));
        Form(preview.PreviewHash);
        http.Request.Headers["X-Step-Up"] = await rig.StepAsync(db, admin);
        var first = Assert.IsType<Ok<CarePlaceCommit>>(await rig.Handlers(db).CsvAsync(http, true, Ct)).Value!;
        Assert.Equal(1, first.Inserted);
        http.Request.Headers["X-Step-Up"] = await rig.StepAsync(db, admin);
        var second = Assert.IsType<Ok<CarePlaceCommit>>(await rig.Handlers(db).CsvAsync(http, true, Ct)).Value!;
        Assert.True(second.AlreadyCommitted);
        Assert.Equal(before + 1, await db.CarePlaces.CountAsync(Ct));
        var place = await db.CarePlaces.AsNoTracking().SingleAsync(x => x.Name == name, Ct);
        Assert.Equal(await db.Districts.Where(d => d.Slug == "kadikoy").Select(d => (Guid?)d.Id).SingleAsync(Ct), place.DistrictId);
        Assert.Equal("+90 212 123 45 67", place.Phone);
    }

    [Fact]
    public async Task SuspendedAdminsDoNotCountTowardsTheLastActiveAdmin()
    {
        await using var rig = new AdminTestRig(database);
        await using var db = database.CreateContext();
        await db.Users.Where(u => u.Role == UserRole.Admin).ExecuteUpdateAsync(s => s.SetProperty(u => u.Role, UserRole.User), Ct);
        var caller = rig.User(UserRole.Admin);
        var target = rig.User(UserRole.Admin);
        db.Users.AddRange(caller, target);
        await db.SaveChangesAsync(Ct);
        var http = rig.Http(caller);
        http.Request.Headers["X-Step-Up"] = await rig.StepAsync(db, caller);
        caller.SuspendedUntil = rig.Clock.Now.AddDays(1);
        await db.SaveChangesAsync(Ct);
        var response = await rig.Handlers(db).RoleAsync(http, target.Id, new AdminRoleRequest("User"), Ct);
        Assert.Equal(409, Status(response));
        Assert.Contains("last_admin_protected", Assert.IsType<ProblemHttpResult>(response).ProblemDetails.Extensions["code"]!.ToString());
    }

    private static async Task<Guid> TargetAsync(PatikaDbContext db, Guid author, string type)
    {
        Entity entity;
        if (type is "adoption" or "photo")
        {
            var animal = new Animal { CreatedBy = author, Name = "Pamuk", Location = new GeoPoint(29, 41) };
            db.Animals.Add(animal);
            await db.SaveChangesAsync(Ct);
            var key = $"animal/{Guid.NewGuid():D}";
            if (type == "photo") db.Uploads.Add(new Upload
            {
                UserId = author,
                Kind = "animal",
                Key = key,
                ContentType = "image/jpeg",
                ContentLength = 100,
                State = "Ready",
                ProcessedAt = DateTimeOffset.UtcNow,
            });
            entity = type == "adoption" ? new AdoptionPost
            {
                AnimalId = animal.Id,
                CreatedBy = author,
                Description = "Needs a home",
                Requirements = "Safe home",
                District = "Kadikoy",
                ClosesAt = DateTimeOffset.UtcNow.AddDays(60),
                State = AdoptionPostState.Pending,
            } : new AnimalPhoto { AnimalId = animal.Id, CreatedBy = author, Key = key, ModerationState = ModerationState.Pending };
        }
        else entity = type == "urgent" ? new UrgentPost
        {
            CreatedBy = author,
            Description = "Needs help",
            PhotoKey = "urgent/test",
            Location = new GeoPoint(29, 41),
        } : new Report { ReporterId = author, Reason = "Please review", TargetType = "animal", TargetId = Guid.NewGuid() };
        db.Add(entity);
        await db.SaveChangesAsync(Ct);
        return entity.Id;
    }

    private static int? Status(IResult result) => (result as IStatusCodeHttpResult)?.StatusCode;
    private sealed class FailAfterSave : SaveChangesInterceptor
    {
        public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("Forced transaction failure.");
    }
}
