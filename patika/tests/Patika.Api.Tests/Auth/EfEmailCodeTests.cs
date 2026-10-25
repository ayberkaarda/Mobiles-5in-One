using Microsoft.EntityFrameworkCore;
using Patika.Api.Features.Auth;
using Patika.Domain.Security;
using Xunit;

namespace Patika.Api.Tests.Auth;

/// <summary><see cref="EfAuthStore"/> code attempts on PostGIS (random host port): the limit holds in SQL.</summary>
public sealed class EfEmailCodeTests(PostgisFixture database) : IClassFixture<PostgisFixture>
{
    private const string NewHash = "$argon2id$v=19$m=65536,t=3,p=1$bmV3$aGFzaA";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task FiveWrongGuessesBurnTheCode()
    {
        await using var db = database.CreateContext();
        var store = new EfAuthStore(db);
        var now = DateTimeOffset.UtcNow;
        var (user, code) = await CreatePendingUserAsync(store, now);

        var wrong = code;
        for (var attempt = 1; attempt <= 5; attempt++)
        {
            wrong = TestEmailCodes.Other(wrong);
            Assert.Null(await store.TryRedeemEmailCodeAsync(user.Id, EmailTokenRecord.VerifyEmail,
                TestEmailCodes.Matcher(EmailTokenRecord.VerifyEmail, wrong), now, Ct));
            Assert.Equal(attempt, await FailedAttemptsAsync(user.Id));
        }

        Assert.Null(await store.TryRedeemEmailCodeAsync(user.Id, EmailTokenRecord.VerifyEmail,
            TestEmailCodes.Matcher(EmailTokenRecord.VerifyEmail, code), now, Ct));
        Assert.Equal(5, await FailedAttemptsAsync(user.Id));
        Assert.NotNull((await db.EmailTokens.AsNoTracking().SingleAsync(t => t.UserId == user.Id, Ct)).UsedAt);
        Assert.Null((await store.FindUserByIdAsync(user.Id, Ct))!.EmailVerifiedAt);
    }

    [Fact]
    public async Task FourWrongGuessesLeaveTheCodeUsable()
    {
        await using var db = database.CreateContext();
        var store = new EfAuthStore(db);
        var now = DateTimeOffset.UtcNow;
        var (user, code) = await CreatePendingUserAsync(store, now);

        var wrong = code;
        for (var attempt = 0; attempt < 4; attempt++)
        {
            wrong = TestEmailCodes.Other(wrong);
            Assert.Null(await store.TryRedeemEmailCodeAsync(user.Id, EmailTokenRecord.VerifyEmail,
                TestEmailCodes.Matcher(EmailTokenRecord.VerifyEmail, wrong), now, Ct));
        }

        Assert.Equal(user.Id, await store.TryRedeemEmailCodeAsync(user.Id, EmailTokenRecord.VerifyEmail,
            TestEmailCodes.Matcher(EmailTokenRecord.VerifyEmail, code), now, Ct));
        Assert.NotNull((await store.FindUserByIdAsync(user.Id, Ct))!.EmailVerifiedAt);
    }

    [Fact]
    public async Task ConcurrentWrongGuessesNeverCountPastTheLimit()
    {
        var now = DateTimeOffset.UtcNow;
        AuthUser user;
        string code;
        await using (var setup = database.CreateContext())
        {
            (user, code) = await CreatePendingUserAsync(new EfAuthStore(setup), now);
        }

        var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var guesses = Enumerable.Range(1, 12).Select(offset => Task.Run(async () =>
        {
            await start.Task;
            await using var db = database.CreateContext();
            var wrong = ((int.Parse(code, System.Globalization.CultureInfo.InvariantCulture) + offset) % 1_000_000)
                .ToString("D6", System.Globalization.CultureInfo.InvariantCulture);
            return await new EfAuthStore(db).TryRedeemEmailCodeAsync(user.Id, EmailTokenRecord.VerifyEmail,
                TestEmailCodes.Matcher(EmailTokenRecord.VerifyEmail, wrong), now, Ct);
        }, Ct)).ToArray();
        start.SetResult();

        Assert.All(await Task.WhenAll(guesses), Assert.Null);
        Assert.Equal(5, await FailedAttemptsAsync(user.Id));
        await using var check = database.CreateContext();
        Assert.Null(await new EfAuthStore(check).TryRedeemEmailCodeAsync(user.Id, EmailTokenRecord.VerifyEmail,
            TestEmailCodes.Matcher(EmailTokenRecord.VerifyEmail, code), now, Ct));
    }

    [Fact]
    public async Task ExpiredAndReplacedCodesAreRejected()
    {
        await using var db = database.CreateContext();
        var store = new EfAuthStore(db);
        var now = DateTimeOffset.UtcNow;
        var (user, code) = await CreatePendingUserAsync(store, now);

        var later = now + EmailCodeHasher.Lifetime + TimeSpan.FromSeconds(1);
        Assert.Null(await store.TryRedeemEmailCodeAsync(user.Id, EmailTokenRecord.VerifyEmail,
            TestEmailCodes.Matcher(EmailTokenRecord.VerifyEmail, code), later, Ct));
        Assert.Equal(0, await FailedAttemptsAsync(user.Id));

        var replacement = await TestEmailCodes.IssueAsync(store, user.Id, EmailTokenRecord.VerifyEmail, now, Ct);
        Assert.Single(await db.EmailTokens.AsNoTracking().Where(t => t.UserId == user.Id && t.UsedAt == null).ToListAsync(Ct));
        if (replacement != code)
        {
            Assert.Null(await store.TryRedeemEmailCodeAsync(user.Id, EmailTokenRecord.VerifyEmail,
                TestEmailCodes.Matcher(EmailTokenRecord.VerifyEmail, code), now, Ct));
        }

        Assert.Equal(user.Id, await store.TryRedeemEmailCodeAsync(user.Id, EmailTokenRecord.VerifyEmail,
            TestEmailCodes.Matcher(EmailTokenRecord.VerifyEmail, replacement), now, Ct));
    }

    [Fact]
    public async Task ResetCodeWrongGuessesCountAndBurnToo()
    {
        await using var db = database.CreateContext();
        var store = new EfAuthStore(db);
        var now = DateTimeOffset.UtcNow;
        var (user, _) = await CreatePendingUserAsync(store, now);
        var code = await TestEmailCodes.IssueAsync(store, user.Id, EmailTokenRecord.PasswordReset, now, Ct);

        var wrong = code;
        for (var attempt = 0; attempt < 5; attempt++)
        {
            wrong = TestEmailCodes.Other(wrong);
            Assert.Null(await store.TryResetPasswordAsync(user.Id,
                TestEmailCodes.Matcher(EmailTokenRecord.PasswordReset, wrong), NewHash, now, Ct));
        }

        Assert.Null(await store.TryResetPasswordAsync(user.Id,
            TestEmailCodes.Matcher(EmailTokenRecord.PasswordReset, code), NewHash, now, Ct));
        Assert.NotEqual(NewHash, (await store.FindUserByIdAsync(user.Id, Ct))!.PasswordHash);
    }

    [Fact]
    public async Task TheDatabaseRejectsAnAttemptCountPastTheLimit()
    {
        await using var db = database.CreateContext();
        var store = new EfAuthStore(db);
        var (user, _) = await CreatePendingUserAsync(store, DateTimeOffset.UtcNow);

        await Assert.ThrowsAnyAsync<Exception>(() => db.Database.ExecuteSqlAsync(
            $"UPDATE email_tokens SET failed_attempts = 6 WHERE user_id = {user.Id}", Ct));
    }

    [Fact]
    public async Task ConcurrentResendsLeaveExactlyOneLiveCode()
    {
        var now = DateTimeOffset.UtcNow;
        AuthUser user;
        await using (var setup = database.CreateContext())
        {
            (user, _) = await CreatePendingUserAsync(new EfAuthStore(setup), now);
        }

        var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var issues = Enumerable.Range(0, 8).Select(_ => Task.Run(async () =>
        {
            await start.Task;
            await using var db = database.CreateContext();
            var (code, record) = TestEmailCodes.New(user.Id, EmailTokenRecord.VerifyEmail, DateTimeOffset.UtcNow);
            return (Issued: await new EfAuthStore(db).StoreEmailTokenAsync(record, Ct), code, record.Id);
        }, Ct)).ToArray();
        start.SetResult();
        var results = await Task.WhenAll(issues);

        Assert.All(results, r => Assert.True(r.Issued));
        await using var check = database.CreateContext();
        var live = await check.EmailTokens.AsNoTracking()
            .Where(t => t.UserId == user.Id && t.Purpose == EmailTokenRecord.VerifyEmail && t.UsedAt == null).ToListAsync(Ct);
        var survivor = Assert.Single(live);
        Assert.Equal(9, await check.EmailTokens.CountAsync(t => t.UserId == user.Id, Ct));

        // Only the surviving code redeems; it is matched by its own row id.
        var winner = results.Single(r => r.Id == survivor.Id);
        Assert.Equal(user.Id, await new EfAuthStore(check).TryRedeemEmailCodeAsync(user.Id, EmailTokenRecord.VerifyEmail,
            TestEmailCodes.Matcher(EmailTokenRecord.VerifyEmail, winner.code), now, Ct));
    }

    [Fact]
    public async Task TheDatabaseAllowsOnlyOneLiveCodePerUserAndPurpose()
    {
        await using var db = database.CreateContext();
        var (user, _) = await CreatePendingUserAsync(new EfAuthStore(db), DateTimeOffset.UtcNow);

        await Assert.ThrowsAnyAsync<Exception>(() => db.Database.ExecuteSqlAsync($"""
            INSERT INTO email_tokens (id, user_id, token_hash, purpose, created_at, updated_at, expires_at)
            VALUES ({Guid.CreateVersion7()}, {user.Id}, {new byte[32]}, 'verify_email', now(), now(), now() + interval '15 minutes')
            """, Ct));
    }

    [Fact]
    public async Task AtMostTenCodesPerPurposeAreIssuedIn24Hours()
    {
        await using var db = database.CreateContext();
        var store = new EfAuthStore(db);
        var now = DateTimeOffset.UtcNow;
        var (user, _) = await CreatePendingUserAsync(store, now);

        // Registration issued the first; nine more fit.
        for (var i = 0; i < 9; i++)
        {
            Assert.True(await store.StoreEmailTokenAsync(TestEmailCodes.New(user.Id, EmailTokenRecord.VerifyEmail, now).Record, Ct));
        }

        var (_, refused) = TestEmailCodes.New(user.Id, EmailTokenRecord.VerifyEmail, now);
        Assert.False(await store.StoreEmailTokenAsync(refused, Ct));
        Assert.False(await db.EmailTokens.AnyAsync(t => t.Id == refused.Id, Ct));
        Assert.Equal(10, await db.EmailTokens.CountAsync(t => t.UserId == user.Id, Ct));

        // Another purpose has its own budget, and codes older than 24 hours stop counting.
        Assert.True(await store.StoreEmailTokenAsync(TestEmailCodes.New(user.Id, EmailTokenRecord.PasswordReset, now).Record, Ct));
        var aged = now.AddHours(-25);
        await db.Database.ExecuteSqlAsync(
            $"UPDATE email_tokens SET created_at = {aged} WHERE user_id = {user.Id} AND purpose = 'verify_email'", Ct);
        Assert.True(await store.StoreEmailTokenAsync(TestEmailCodes.New(user.Id, EmailTokenRecord.VerifyEmail, now).Record, Ct));
    }


    private static async Task<(AuthUser User, string Code)> CreatePendingUserAsync(EfAuthStore store, DateTimeOffset now)
    {
        var user = new AuthUser(Guid.CreateVersion7(), $"code.{Guid.NewGuid():N}@example.org",
            "$argon2id$v=19$m=65536,t=3,p=1$b2xk$aGFzaA", "Pamuk", ActorRole.User, null, null);
        var (code, record) = TestEmailCodes.New(user.Id, EmailTokenRecord.VerifyEmail, now);
        Assert.True(await store.TryCreateUserAsync(user, null, record, Ct));
        return (user, code);
    }

    private async Task<int> FailedAttemptsAsync(Guid userId)
    {
        await using var db = database.CreateContext();
        var counts = await db.Database
            .SqlQuery<int>($"SELECT failed_attempts AS \"Value\" FROM email_tokens WHERE user_id = {userId} AND purpose = 'verify_email'")
            .ToListAsync(Ct);
        return Assert.Single(counts);
    }
}
