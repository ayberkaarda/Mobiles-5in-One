using Microsoft.EntityFrameworkCore;
using Patika.Api.Features.Account;
using Patika.Api.Features.Auth;
using Patika.Api.Security.Tokens;
using Patika.Api.Tests.Auth;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Domain.Security;
using Xunit;

namespace Patika.Api.Tests.Account;

/// <summary><see cref="EfAccountDeletionStore"/> against PostGIS (random host port).</summary>
public sealed class EfAccountDeletionStoreTests(PostgisFixture database) : IClassFixture<PostgisFixture>, IAsyncLifetime
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        await using var db = database.CreateContext();
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    [Fact]
    public async Task RequestDeactivatesAndClearsSessionsDevicesFollowsAndOpenPosts()
    {
        await using var db = database.CreateContext();
        var auth = new EfAuthStore(db);
        var now = DateTimeOffset.UtcNow;
        var user = await CreateUserAsync(auth);
        var other = await CreateUserAsync(auth);
        await auth.AddRefreshTokenAsync(Refresh(user.Id, now), Ct);
        await auth.AddRefreshTokenAsync(Refresh(user.Id, now), Ct);
        await auth.AddRefreshTokenAsync(Refresh(other.Id, now), Ct);

        var animal = new Animal { Location = new GeoPoint(29.0, 41.0), Species = Species.Cat, CreatedBy = other.Id };
        db.Animals.Add(animal);
        db.Follows.AddRange(new Follow { UserId = user.Id, AnimalId = animal.Id }, new Follow { UserId = other.Id, AnimalId = animal.Id });
        db.DeviceTokens.AddRange(Device(user.Id), Device(other.Id));
        db.AdoptionPosts.AddRange(
            Post(animal.Id, user.Id, AdoptionPostState.Published, now.AddDays(20)),
            Post(animal.Id, user.Id, AdoptionPostState.Pending, now.AddDays(20)),
            Post(animal.Id, user.Id, AdoptionPostState.Rejected, now.AddDays(20)),
            Post(animal.Id, other.Id, AdoptionPostState.Published, now.AddDays(20)));
        await db.SaveChangesAsync(Ct);
        db.ChangeTracker.Clear();

        var schedule = await new EfAccountDeletionStore(db).RequestDeletionAsync(user.Id, now, TimeSpan.FromDays(7), Ct);

        Assert.NotNull(schedule);
        Assert.True(schedule.Created);
        Assert.Equal(now.AddDays(7).ToUnixTimeMilliseconds(), schedule.ExecuteAfter.ToUnixTimeMilliseconds());
        Assert.False((await auth.FindUserByIdAsync(user.Id, Ct))!.IsActive);
        Assert.True((await auth.FindUserByIdAsync(other.Id, Ct))!.IsActive);
        Assert.All(await db.RefreshTokens.AsNoTracking().Where(t => t.UserId == user.Id).ToListAsync(Ct),
            t => Assert.NotNull(t.RevokedAt));
        Assert.Null((await db.RefreshTokens.AsNoTracking().SingleAsync(t => t.UserId == other.Id, Ct)).RevokedAt);
        Assert.False(await db.DeviceTokens.AnyAsync(t => t.UserId == user.Id, Ct));
        Assert.True(await db.DeviceTokens.AnyAsync(t => t.UserId == other.Id, Ct));
        Assert.False(await db.Follows.AnyAsync(f => f.UserId == user.Id, Ct));
        Assert.True(await db.Follows.AnyAsync(f => f.UserId == other.Id, Ct));

        var states = await db.AdoptionPosts.AsNoTracking().Where(p => p.CreatedBy == user.Id)
            .Select(p => p.State).ToListAsync(Ct);
        Assert.Equal(2, states.Count(s => s == AdoptionPostState.Closed));
        Assert.Single(states, AdoptionPostState.Rejected);
        Assert.Equal(AdoptionPostState.Published,
            (await db.AdoptionPosts.AsNoTracking().SingleAsync(p => p.CreatedBy == other.Id, Ct)).State);

        var request = await db.DeletionRequests.AsNoTracking().SingleAsync(r => r.UserId == user.Id, Ct);
        Assert.Null(request.CompletedAt);
        Assert.Null(request.CancelledAt);
        var audit = await db.AuditLogs.AsNoTracking().SingleAsync(a => a.TargetId == user.Id, Ct);
        Assert.Equal(AccountAuditActions.DeletionRequested, audit.Action);
        Assert.Null(audit.DetailsJson);
    }

    [Fact]
    public async Task RepeatedRequestsReturnThePendingScheduleAndBannedAccountsGetNone()
    {
        await using var db = database.CreateContext();
        var auth = new EfAuthStore(db);
        var deletions = new EfAccountDeletionStore(db);
        var now = DateTimeOffset.UtcNow;
        var user = await CreateUserAsync(auth);
        var banned = await CreateUserAsync(auth);
        await db.Users.Where(u => u.Id == banned.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.DeactivatedAt, now), Ct);

        var first = await deletions.RequestDeletionAsync(user.Id, now, TimeSpan.FromDays(7), Ct);
        var second = await deletions.RequestDeletionAsync(user.Id, now.AddMinutes(1), TimeSpan.FromDays(7), Ct);

        Assert.True(first!.Created);
        Assert.False(second!.Created);
        Assert.Equal(first.RequestId, second.RequestId);
        Assert.Null(await deletions.RequestDeletionAsync(banned.Id, now, TimeSpan.FromDays(7), Ct));
        Assert.Null(await deletions.RequestDeletionAsync(Guid.CreateVersion7(), now, TimeSpan.FromDays(7), Ct));
        Assert.Equal(1, await db.DeletionRequests.CountAsync(r => r.UserId == user.Id, Ct));
    }

    private static async Task<AuthUser> CreateUserAsync(EfAuthStore store)
    {
        var user = new AuthUser(Guid.CreateVersion7(), $"sil.{Guid.NewGuid():N}@example.org", "$argon2id$x", "Tekir",
            ActorRole.User, DateTimeOffset.UtcNow, null);
        Assert.True(await store.TryCreateUserAsync(user, null, null, Ct));
        return user;
    }

    private static RefreshTokenRecord Refresh(Guid userId, DateTimeOffset now) =>
        new(Guid.CreateVersion7(), userId, Guid.CreateVersion7(), RefreshTokens.Hash(RefreshTokens.NewToken()), now,
            now.AddDays(30), null, null);

    private static DeviceToken Device(Guid userId) => new()
    {
        UserId = userId,
        Token = Guid.NewGuid().ToString("N"),
        InstallationId = Guid.NewGuid(),
        Environment = StoreEnvironment.Sandbox,
        LastSeenAt = DateTimeOffset.UtcNow,
    };

    private static AdoptionPost Post(Guid animalId, Guid createdBy, AdoptionPostState state, DateTimeOffset closesAt) => new()
    {
        AnimalId = animalId,
        CreatedBy = createdBy,
        Description = "Uysal tekir, yuva arıyor.",
        Requirements = "Kapalı balkon.",
        District = "Kadıköy",
        State = state,
        ClosesAt = closesAt,
    };
}
