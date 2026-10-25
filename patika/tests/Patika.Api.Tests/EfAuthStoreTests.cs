using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Patika.Api.Features.Auth;
using Patika.Api.Security.Passwords;
using Patika.Api.Security.Tokens;
using Patika.Domain.Security;
using Patika.Infrastructure.Persistence;
using Testcontainers.PostgreSql;
using Xunit;

namespace Patika.Api.Tests;

/// <summary>Runs <see cref="EfAuthStore"/> against a throwaway PostGIS container (random host port).</summary>
public sealed class PostgisFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer container = new PostgreSqlBuilder("postgis/postgis:17-3.5")
        .WithDatabase("patika")
        .WithUsername("patika")
        .WithPassword("patika-test")
        .Build();

    public string ConnectionString => container.GetConnectionString();

    public async ValueTask InitializeAsync()
    {
        await container.StartAsync();
        await using var db = CreateContext();
        await db.Database.EnsureCreatedAsync();
    }

    public async ValueTask DisposeAsync() => await container.DisposeAsync();

    public PatikaDbContext CreateContext(params IInterceptor[] interceptors) => new(new DbContextOptionsBuilder<PatikaDbContext>()
        .UseNpgsql(ConnectionString, postgres => postgres.UseNetTopologySuite())
        .AddInterceptors(interceptors)
        .Options);
}

public sealed class EfAuthStoreTests(PostgisFixture database) : IClassFixture<PostgisFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task UsersAreUniqueByEmailAndStoreOnlyArgon2idHashes()
    {
        await using var db = database.CreateContext();
        var store = new EfAuthStore(db);
        var email = $"ef.{Guid.NewGuid():N}@example.org";
        var hash = await new Argon2idPasswordHasher().HashAsync("veritabani-sifresi-1", Ct);
        var user = new AuthUser(Guid.CreateVersion7(), email, hash, "Pamuk", ActorRole.Trusted, null, null);

        Assert.True(await store.TryCreateUserAsync(user, null, null, Ct));
        Assert.False(await store.TryCreateUserAsync(user with { Id = Guid.CreateVersion7() }, null, null, Ct));

        var loaded = await store.FindUserByEmailAsync(email, Ct);
        Assert.Equal(ActorRole.Trusted, loaded!.Role);
        var hashes = await db.Users.Where(u => u.PasswordHash != null).Select(u => u.PasswordHash!).ToListAsync(Ct);
        Assert.All(hashes, h => Assert.StartsWith("$argon2id$", h, StringComparison.Ordinal));
    }

    [Fact]
    public async Task ExternalLoginsAreUniquePerProviderSubject()
    {
        await using var db = database.CreateContext();
        var store = new EfAuthStore(db);
        var user = new AuthUser(Guid.CreateVersion7(), null, null, "Google Gönüllüsü", ActorRole.User, null, null);
        var key = new ExternalLoginKey("google", $"sub-{Guid.NewGuid():N}");

        Assert.True(await store.TryCreateUserAsync(user, key, null, Ct));
        Assert.Equal(user.Id, (await store.FindUserByExternalLoginAsync(key, Ct))!.Id);
        Assert.False(await store.TryLinkExternalLoginAsync(user.Id, key, Ct));
    }

    [Fact]
    public async Task RotationIsCompareAndSetAndFamilyRevocationIsComplete()
    {
        await using var db = database.CreateContext();
        var store = new EfAuthStore(db);
        var user = new AuthUser(Guid.CreateVersion7(), $"rt.{Guid.NewGuid():N}@example.org", null, "Pamuk", ActorRole.User, null, null);
        await store.TryCreateUserAsync(user, null, null, Ct);
        var now = DateTimeOffset.UtcNow;
        var family = Guid.CreateVersion7();
        var first = Record(user.Id, family, now);
        await store.AddRefreshTokenAsync(first, Ct);

        var second = Record(user.Id, family, now);
        var third = Record(user.Id, family, now);
        Assert.True(await store.TryRotateRefreshTokenAsync(first.Id, second, now, Ct));
        Assert.False(await store.TryRotateRefreshTokenAsync(first.Id, third, now, Ct));
        Assert.Null(await store.FindRefreshTokenAsync(third.TokenHash, Ct));

        var rotated = await store.FindRefreshTokenAsync(first.TokenHash, Ct);
        Assert.NotNull(rotated!.RevokedAt);
        Assert.Equal(second.Id, rotated.ReplacedById);

        Assert.Equal(1, await store.RevokeFamilyAsync(family, now, Ct));
        Assert.NotNull((await store.FindRefreshTokenAsync(second.TokenHash, Ct))!.RevokedAt);
        var stored = await db.RefreshTokens.Where(t => t.FamilyId == family).Select(t => t.TokenHash).ToListAsync(Ct);
        Assert.All(stored, h => Assert.Equal(32, h.Length));
    }

    [Fact]
    public async Task FamilyRevocationDuringAnInFlightRotationAlsoRevokesTheReplacement()
    {
        var (userId, family, first) = await SeedFamilyAsync();
        var second = Record(userId, family, DateTimeOffset.UtcNow);

        // Rotation pauses after updating the old row and before committing.
        var pause = new PauseAfterCommand("UPDATE");
        await using var rotatingDb = database.CreateContext(pause);
        var rotation = new EfAuthStore(rotatingDb).TryRotateRefreshTokenAsync(first.Id, second, DateTimeOffset.UtcNow, Ct);
        await pause.Reached.Task.WaitAsync(TimeSpan.FromSeconds(30), Ct);

        await using var revokingDb = database.CreateContext();
        var revocation = new EfAuthStore(revokingDb).RevokeFamilyAsync(family, DateTimeOffset.UtcNow, Ct);
        await Task.Delay(300, Ct);
        pause.Release.SetResult();

        Assert.True(await rotation);
        await revocation;
        await using var check = database.CreateContext();
        var rows = await check.RefreshTokens.AsNoTracking().Where(t => t.FamilyId == family).ToListAsync(Ct);
        Assert.Equal(2, rows.Count);
        Assert.All(rows, row => Assert.NotNull(row.RevokedAt));
    }

    [Fact]
    public async Task RotationAfterAnInFlightFamilyRevocationIsRefused()
    {
        var (userId, family, first) = await SeedFamilyAsync();

        var pause = new PauseAfterCommand("UPDATE");
        await using var revokingDb = database.CreateContext(pause);
        var revocation = new EfAuthStore(revokingDb).RevokeFamilyAsync(family, DateTimeOffset.UtcNow, Ct);
        await pause.Reached.Task.WaitAsync(TimeSpan.FromSeconds(30), Ct);

        await using var rotatingDb = database.CreateContext();
        var second = Record(userId, family, DateTimeOffset.UtcNow);
        var rotation = new EfAuthStore(rotatingDb).TryRotateRefreshTokenAsync(first.Id, second, DateTimeOffset.UtcNow, Ct);
        await Task.Delay(300, Ct);
        pause.Release.SetResult();

        Assert.Equal(1, await revocation);
        Assert.False(await rotation);
        await using var check = database.CreateContext();
        Assert.Null(await new EfAuthStore(check).FindRefreshTokenAsync(second.TokenHash, Ct));
    }

    [Fact]
    public async Task EmailTokensAreHashedSingleUseAndMarkTheAddressVerified()
    {
        await using var db = database.CreateContext();
        var store = new EfAuthStore(db);
        var now = DateTimeOffset.UtcNow;
        var user = new AuthUser(Guid.CreateVersion7(), $"et.{Guid.NewGuid():N}@example.org", null, "Pamuk", ActorRole.User, null, null);
        var code = RefreshTokens.NewToken();
        var token = new EmailTokenRecord(Guid.CreateVersion7(), user.Id, RefreshTokens.Hash(code), EmailTokenRecord.VerifyEmail,
            now, now.AddHours(24));
        var expiredUser = user with { Id = Guid.CreateVersion7(), Email = $"ex.{Guid.NewGuid():N}@example.org" };
        var expiredCode = RefreshTokens.NewToken();
        var expired = token with
        {
            Id = Guid.CreateVersion7(),
            UserId = expiredUser.Id,
            TokenHash = RefreshTokens.Hash(expiredCode),
            ExpiresAt = now.AddSeconds(-1),
        };

        Assert.True(await store.TryCreateUserAsync(user, null, token, Ct));
        Assert.True(await store.TryCreateUserAsync(expiredUser, null, expired, Ct));

        Assert.Null(await store.TryConsumeEmailTokenAsync(RefreshTokens.Hash(code), "reset_password", now, Ct));
        Assert.Equal(user.Id, await store.TryConsumeEmailTokenAsync(RefreshTokens.Hash(code), EmailTokenRecord.VerifyEmail, now, Ct));
        Assert.Null(await store.TryConsumeEmailTokenAsync(RefreshTokens.Hash(code), EmailTokenRecord.VerifyEmail, now, Ct));
        Assert.Null(await store.TryConsumeEmailTokenAsync(RefreshTokens.Hash(expiredCode), EmailTokenRecord.VerifyEmail, now, Ct));
        Assert.NotNull((await store.FindUserByIdAsync(user.Id, Ct))!.EmailVerifiedAt);
        Assert.Null((await store.FindUserByIdAsync(expiredUser.Id, Ct))!.EmailVerifiedAt);
        var stored = await db.EmailTokens.AsNoTracking().Where(t => t.UserId == user.Id).SingleAsync(Ct);
        Assert.Equal(32, stored.TokenHash.Length);
        Assert.Equal("verify_email", stored.Purpose);
        Assert.NotNull(stored.UsedAt);
    }

    private async Task<(Guid UserId, Guid Family, RefreshTokenRecord First)> SeedFamilyAsync()
    {
        await using var db = database.CreateContext();
        var store = new EfAuthStore(db);
        var user = new AuthUser(Guid.CreateVersion7(), $"race.{Guid.NewGuid():N}@example.org", null, "Pamuk", ActorRole.User, null, null);
        Assert.True(await store.TryCreateUserAsync(user, null, null, Ct));
        var family = Guid.CreateVersion7();
        var first = Record(user.Id, family, DateTimeOffset.UtcNow);
        await store.AddRefreshTokenAsync(first, Ct);
        return (user.Id, family, first);
    }

    /// <summary>Blocks the first matching command after it executes, inside its transaction.</summary>
    private sealed class PauseAfterCommand(string prefix) : DbCommandInterceptor
    {
        private int fired;

        public TaskCompletionSource Reached { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public override async ValueTask<int> NonQueryExecutedAsync(
            DbCommand command, CommandExecutedEventData eventData, int result, CancellationToken cancellationToken = default)
        {
            await PauseIfMatchAsync(command);
            return result;
        }

        public override async ValueTask<DbDataReader> ReaderExecutedAsync(
            DbCommand command, CommandExecutedEventData eventData, DbDataReader result, CancellationToken cancellationToken = default)
        {
            await PauseIfMatchAsync(command);
            return result;
        }

        private async Task PauseIfMatchAsync(DbCommand command)
        {
            if (command.CommandText.TrimStart().StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
                && command.CommandText.Contains("refresh_tokens", StringComparison.Ordinal)
                && Interlocked.Exchange(ref fired, 1) == 0)
            {
                Reached.SetResult();
                await Release.Task;
            }
        }
    }

    private static RefreshTokenRecord Record(Guid userId, Guid family, DateTimeOffset now) =>
        new(Guid.CreateVersion7(), userId, family, RefreshTokens.Hash(RefreshTokens.NewToken()), now, now.AddDays(30), null, null);
}
