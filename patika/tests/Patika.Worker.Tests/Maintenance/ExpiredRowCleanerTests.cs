using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Patika.Domain.Entities;
using Patika.Worker.Jobs.Maintenance;
using Xunit;

namespace Patika.Worker.Tests.Maintenance;

public sealed class ExpiredRowCleanerTests(WorkerPostgisFixture database) : IClassFixture<WorkerPostgisFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private async Task<Guid> UserAsync()
    {
        await using var db = database.CreateContext();
        var user = new User { DisplayName = "Gönüllü" };
        db.Users.Add(user);
        await db.SaveChangesAsync(Ct);
        return user.Id;
    }

    private ExpiredRowCleaner Cleaner(Patika.Infrastructure.Persistence.PatikaDbContext db) =>
        new(db, TimeProvider.System, NullLogger<ExpiredRowCleaner>.Instance);

    [Fact]
    public async Task RemovesOldIdempotencyKeysInBatchesAndKeepsRecentOnes()
    {
        var user = await UserAsync();
        await using (var seed = database.CreateContext())
        {
            // More than two batches of expired rows, and three inside the 24 hour window.
            await seed.Database.ExecuteSqlAsync(
                $"""
                INSERT INTO idempotency_keys (id, user_id, key, request_hash, status_code, response_body, created_at, updated_at)
                SELECT gen_random_uuid(), {user}, gen_random_uuid(), decode(repeat('00', 32), 'hex'), 201, ''::bytea,
                       now() - interval '25 hours' - (g * interval '1 second'), now()
                FROM generate_series(1, 2500) AS g
                """, Ct);
            await seed.Database.ExecuteSqlAsync(
                $"""
                INSERT INTO idempotency_keys (id, user_id, key, request_hash, status_code, response_body, created_at, updated_at)
                SELECT gen_random_uuid(), {user}, gen_random_uuid(), decode(repeat('00', 32), 'hex'), 201, ''::bytea,
                       now() - (g * interval '7 hours'), now()
                FROM generate_series(1, 3) AS g
                """, Ct);
        }

        await using var db = database.CreateContext();
        var (keys, _) = await Cleaner(db).CleanAsync(Ct);

        Assert.Equal(2500, keys);
        await using var check = database.CreateContext();
        Assert.Equal(3, await check.IdempotencyKeys.CountAsync(row => row.UserId == user, Ct));
        Assert.Equal(0, (await Cleaner(check).CleanAsync(Ct)).IdempotencyKeys);
    }

    [Fact]
    public async Task RemovesEmailTokensUsedOrExpiredOverSevenDaysAgoOnly()
    {
        var now = DateTimeOffset.UtcNow;
        var usedOld = await UserAsync();
        var usedRecent = await UserAsync();
        var expiredOld = await UserAsync();
        var expiredRecent = await UserAsync();
        var live = await UserAsync();

        await using (var seed = database.CreateContext())
        {
            seed.EmailTokens.AddRange(
                Token(usedOld, expires: now.AddDays(-9), used: now.AddDays(-8)),
                Token(usedRecent, expires: now.AddDays(-2), used: now.AddDays(-1)),
                Token(expiredOld, expires: now.AddDays(-8), used: null),
                Token(expiredRecent, expires: now.AddDays(-1), used: null),
                Token(live, expires: now.AddMinutes(10), used: null));
            await seed.SaveChangesAsync(Ct);
        }

        await using (var db = database.CreateContext())
        {
            await Cleaner(db).CleanAsync(Ct);
        }

        await using var check = database.CreateContext();
        var left = await check.EmailTokens.Select(t => t.UserId).ToListAsync(Ct);
        Assert.DoesNotContain(usedOld, left);
        Assert.DoesNotContain(expiredOld, left);
        Assert.Contains(usedRecent, left);
        Assert.Contains(expiredRecent, left);
        Assert.Contains(live, left);
    }

    private static EmailToken Token(Guid userId, DateTimeOffset expires, DateTimeOffset? used) => new()
    {
        UserId = userId,
        TokenHash = System.Security.Cryptography.RandomNumberGenerator.GetBytes(32),
        Purpose = "verify_email",
        ExpiresAt = expires,
        UsedAt = used,
        CreatedAt = expires.AddMinutes(-15),
    };
}
