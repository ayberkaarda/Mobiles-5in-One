using Microsoft.EntityFrameworkCore;
using Patika.Api.Features.Auth;
using Patika.Api.Security.Tokens;
using Patika.Domain.Entities;
using Patika.Domain.Security;
using Xunit;

namespace Patika.Api.Tests.Auth;

/// <summary><see cref="EfAuthStore"/> reset and grace-cancel paths against PostGIS (random host port).</summary>
public sealed class EfPasswordResetTests(PostgisFixture database) : IClassFixture<PostgisFixture>, IAsyncLifetime
{
    private const string NewHash = "$argon2id$v=19$m=65536,t=3,p=1$bmV3$aGFzaA";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        await using var db = database.CreateContext();
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    [Fact]
    public async Task ResetIsSingleUseAndRevokesEveryFamilyOfTheUser()
    {
        await using var db = database.CreateContext();
        var store = new EfAuthStore(db);
        var now = DateTimeOffset.UtcNow;
        var user = await CreateUserAsync(store);
        var other = await CreateUserAsync(store);
        var families = new[] { Guid.CreateVersion7(), Guid.CreateVersion7(), Guid.CreateVersion7() };
        foreach (var family in families)
        {
            await store.AddRefreshTokenAsync(Refresh(user.Id, family, now), Ct);
        }

        var bystander = Refresh(other.Id, Guid.CreateVersion7(), now);
        await store.AddRefreshTokenAsync(bystander, Ct);
        var code = await IssueCodeAsync(store, user.Id, now);

        Assert.Equal(user.Id, await store.TryResetPasswordAsync(user.Id, TestEmailCodes.Matcher(EmailTokenRecord.PasswordReset, code), NewHash, now, Ct));
        Assert.Null(await store.TryResetPasswordAsync(user.Id, TestEmailCodes.Matcher(EmailTokenRecord.PasswordReset, code), "$argon2id$again", now, Ct));

        var tokens = await db.RefreshTokens.AsNoTracking().Where(t => t.UserId == user.Id).ToListAsync(Ct);
        Assert.Equal(3, tokens.Count);
        Assert.All(tokens, t => Assert.NotNull(t.RevokedAt));
        Assert.True(EfAuthStore.IsFamilyRevoked(tokens));
        Assert.Null((await db.RefreshTokens.AsNoTracking().SingleAsync(t => t.Id == bystander.Id, Ct)).RevokedAt);
        Assert.Equal(NewHash, (await store.FindUserByIdAsync(user.Id, Ct))!.PasswordHash);
    }

    [Fact]
    public async Task ExpiredCodeChangesNothing()
    {
        await using var db = database.CreateContext();
        var store = new EfAuthStore(db);
        var now = DateTimeOffset.UtcNow;
        var user = await CreateUserAsync(store);
        var session = Refresh(user.Id, Guid.CreateVersion7(), now);
        await store.AddRefreshTokenAsync(session, Ct);
        var code = await IssueCodeAsync(store, user.Id, now);

        var later = now + AuthHandlers.PasswordResetLifetime + TimeSpan.FromSeconds(1);
        Assert.Null(await store.TryResetPasswordAsync(user.Id, TestEmailCodes.Matcher(EmailTokenRecord.PasswordReset, code), NewHash, later, Ct));

        Assert.Equal(user.PasswordHash, (await store.FindUserByIdAsync(user.Id, Ct))!.PasswordHash);
        Assert.Null((await db.RefreshTokens.AsNoTracking().SingleAsync(t => t.Id == session.Id, Ct)).RevokedAt);
        Assert.Null((await db.EmailTokens.AsNoTracking().SingleAsync(t => t.UserId == user.Id, Ct)).UsedAt);
    }

    [Fact]
    public async Task OnlyTheNewestCodeIsKeptAndAVerifyCodeCannotResetAPassword()
    {
        await using var db = database.CreateContext();
        var store = new EfAuthStore(db);
        var now = DateTimeOffset.UtcNow;
        var (verifyCode, verifyRecord) = TestEmailCodes.New(Guid.Empty, EmailTokenRecord.VerifyEmail, now);
        var user = await CreateUserAsync(store, verifyRecord);
        var first = await IssueCodeAsync(store, user.Id, now);
        var second = await IssueCodeAsync(store, user.Id, now);

        Assert.Null(await store.TryResetPasswordAsync(user.Id, TestEmailCodes.Matcher(EmailTokenRecord.PasswordReset, verifyCode), NewHash, now, Ct));
        Assert.Null(await store.TryResetPasswordAsync(user.Id, TestEmailCodes.Matcher(EmailTokenRecord.PasswordReset, first), NewHash, now, Ct));
        Assert.Equal(user.Id, await store.TryResetPasswordAsync(user.Id, TestEmailCodes.Matcher(EmailTokenRecord.PasswordReset, second), NewHash, now, Ct));
        Assert.Empty(await db.EmailTokens.AsNoTracking()
            .Where(t => t.UserId == user.Id && t.Purpose == EmailTokenRecord.PasswordReset && t.UsedAt == null).ToListAsync(Ct));
        Assert.NotNull((await store.FindUserByIdAsync(user.Id, Ct))!.EmailVerifiedAt);
    }

    [Fact]
    public async Task DeactivatedAccountsCannotReset()
    {
        await using var db = database.CreateContext();
        var store = new EfAuthStore(db);
        var now = DateTimeOffset.UtcNow;
        var user = await CreateUserAsync(store);
        var code = await IssueCodeAsync(store, user.Id, now);
        await db.Users.Where(u => u.Id == user.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.DeactivatedAt, now), Ct);

        Assert.Null(await store.TryResetPasswordAsync(user.Id, TestEmailCodes.Matcher(EmailTokenRecord.PasswordReset, code), NewHash, now, Ct));
        Assert.Null((await db.EmailTokens.AsNoTracking().SingleAsync(t => t.UserId == user.Id, Ct)).UsedAt);
    }

    [Fact]
    public async Task SignInCancelsOnlyAPendingDeletionInsideItsGracePeriod()
    {
        await using var db = database.CreateContext();
        var store = new EfAuthStore(db);
        var now = DateTimeOffset.UtcNow;
        var inGrace = await CreateUserAsync(store);
        var expired = await CreateUserAsync(store);
        var banned = await CreateUserAsync(store);
        db.DeletionRequests.AddRange(
            new DeletionRequest { UserId = inGrace.Id, RequestedAt = now, ExecuteAfter = now.AddDays(7) },
            new DeletionRequest { UserId = expired.Id, RequestedAt = now.AddDays(-8), ExecuteAfter = now.AddDays(-1) });
        await db.SaveChangesAsync(Ct);
        db.ChangeTracker.Clear();
        await db.Users.Where(u => u.Id == inGrace.Id || u.Id == expired.Id || u.Id == banned.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.DeactivatedAt, now), Ct);

        Assert.True(await store.TryCancelPendingDeletionAsync(inGrace.Id, now, Ct));
        Assert.False(await store.TryCancelPendingDeletionAsync(inGrace.Id, now, Ct));
        Assert.False(await store.TryCancelPendingDeletionAsync(expired.Id, now, Ct));
        Assert.False(await store.TryCancelPendingDeletionAsync(banned.Id, now, Ct));

        Assert.True((await store.FindUserByIdAsync(inGrace.Id, Ct))!.IsActive);
        Assert.False((await store.FindUserByIdAsync(expired.Id, Ct))!.IsActive);
        Assert.False((await store.FindUserByIdAsync(banned.Id, Ct))!.IsActive);
        Assert.NotNull((await db.DeletionRequests.AsNoTracking().SingleAsync(r => r.UserId == inGrace.Id, Ct)).CancelledAt);
    }

    private static async Task<AuthUser> CreateUserAsync(EfAuthStore store, EmailTokenRecord? emailToken = null)
    {
        var user = new AuthUser(Guid.CreateVersion7(), $"reset.{Guid.NewGuid():N}@example.org",
            "$argon2id$v=19$m=65536,t=3,p=1$b2xk$aGFzaA", "Pamuk", ActorRole.User, null, null);
        Assert.True(await store.TryCreateUserAsync(user, null, emailToken is null ? null : emailToken with { UserId = user.Id }, Ct));
        return user;
    }

    private static async Task<string> IssueCodeAsync(EfAuthStore store, Guid userId, DateTimeOffset now)
    {
        return await TestEmailCodes.IssueAsync(store, userId, EmailTokenRecord.PasswordReset, now, Ct);
    }

    private static RefreshTokenRecord Refresh(Guid userId, Guid familyId, DateTimeOffset now) =>
        new(Guid.CreateVersion7(), userId, familyId, RefreshTokens.Hash(RefreshTokens.NewToken()), now, now.AddDays(30), null, null);
}
