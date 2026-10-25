using Microsoft.EntityFrameworkCore;
using Npgsql;
using Patika.Api.Features.Account;
using Patika.Api.Features.Auth;
using Patika.Api.Security.Tokens;
using Patika.Domain.Security;
using Patika.Infrastructure.Persistence;
using Xunit;

namespace Patika.Api.Tests.Auth;

/// <summary>Session versions and session issuance against PostGIS, including real concurrent races.</summary>
public sealed class EfSessionVersionTests(PostgisFixture database) : IClassFixture<PostgisFixture>, IAsyncLifetime
{
    private const string OldHash = "$argon2id$v=19$m=65536,t=3,p=1$b2xk$aGFzaA";
    private const string NewHash = "$argon2id$v=19$m=65536,t=3,p=1$bmV3$aGFzaA";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        await using var db = database.CreateContext();
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    [Fact]
    public async Task ResetDeletionRequestAndCancelEachBumpTheVersion()
    {
        await using var db = database.CreateContext();
        var store = new EfAuthStore(db);
        var now = DateTimeOffset.UtcNow;
        var user = await CreateUserAsync(store);
        Assert.Equal(0, await store.GetSessionVersionAsync(user.Id, Ct));

        var code = await IssueResetCodeAsync(store, user.Id, now);
        Assert.NotNull(await store.TryResetPasswordAsync(RefreshTokens.Hash(code), NewHash, now, Ct));
        Assert.Equal(1, await store.GetSessionVersionAsync(user.Id, Ct));

        Assert.True((await new EfAccountDeletionStore(db).RequestDeletionAsync(user.Id, now, TimeSpan.FromDays(7), Ct))!.Created);
        Assert.Equal(2, await store.GetSessionVersionAsync(user.Id, Ct));

        Assert.True(await store.TryCancelPendingDeletionAsync(user.Id, now.AddMinutes(1), Ct));
        Assert.Equal(3, await store.GetSessionVersionAsync(user.Id, Ct));
        Assert.Null(await store.GetSessionVersionAsync(Guid.CreateVersion7(), Ct));
    }

    [Fact]
    public async Task IssuingRefusesAReplacedPasswordAndAnInactiveAccount()
    {
        await using var db = database.CreateContext();
        var store = new EfAuthStore(db);
        var user = await CreateUserAsync(store);

        Assert.Equal(0, await store.TryIssueSessionAsync(Refresh(user.Id), OldHash, Ct));
        Assert.Null(await store.TryIssueSessionAsync(Refresh(user.Id), NewHash, Ct));
        await db.Users.Where(u => u.Id == user.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.DeactivatedAt, DateTimeOffset.UtcNow), Ct);
        Assert.Null(await store.TryIssueSessionAsync(Refresh(user.Id), null, Ct));
        Assert.Equal(1, await db.RefreshTokens.CountAsync(t => t.UserId == user.Id, Ct));
    }

    [Fact]
    public async Task ALoginWaitingOnAnInFlightResetIsRefusedOnceTheResetCommits()
    {
        await using var db = database.CreateContext();
        var store = new EfAuthStore(db);
        var user = await CreateUserAsync(store);

        // A reset holds the user row (password changed, version bumped) but has not committed yet.
        await using var connection = new NpgsqlConnection(database.ConnectionString);
        await connection.OpenAsync(Ct);
        await using var transaction = await connection.BeginTransactionAsync(Ct);
        await using (var update = new NpgsqlCommand(
            "UPDATE users SET password_hash = @hash, session_version = session_version + 1 WHERE id = @id", connection, transaction))
        {
            update.Parameters.AddWithValue("hash", NewHash);
            update.Parameters.AddWithValue("id", user.Id);
            Assert.Equal(1, await update.ExecuteNonQueryAsync(Ct));
        }

        await using var issuingDb = database.CreateContext();
        var issuing = new EfAuthStore(issuingDb).TryIssueSessionAsync(Refresh(user.Id), OldHash, Ct);
        await Task.Delay(TimeSpan.FromMilliseconds(500), Ct);
        Assert.False(issuing.IsCompleted, "issuance must wait for the user row lock");

        await transaction.CommitAsync(Ct);

        Assert.Null(await issuing);
        Assert.Equal(0, await db.RefreshTokens.CountAsync(t => t.UserId == user.Id, Ct));
    }

    [Fact]
    public async Task ConcurrentLoginsAndResetsNeverLeaveALiveSessionFromTheOldPassword()
    {
        for (var round = 0; round < 20; round++)
        {
            await using var setupDb = database.CreateContext();
            var setup = new EfAuthStore(setupDb);
            var now = DateTimeOffset.UtcNow;
            var user = await CreateUserAsync(setup);
            var code = await IssueResetCodeAsync(setup, user.Id, now);

            await using var loginDb = database.CreateContext();
            await using var resetDb = database.CreateContext();
            var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var login = Task.Run(async () =>
            {
                await start.Task;
                return await new EfAuthStore(loginDb).TryIssueSessionAsync(Refresh(user.Id), OldHash, Ct);
            }, Ct);
            var reset = Task.Run(async () =>
            {
                await start.Task;
                return await new EfAuthStore(resetDb).TryResetPasswordAsync(RefreshTokens.Hash(code), NewHash, now, Ct);
            }, Ct);
            start.SetResult();
            var issuedVersion = await login;
            Assert.Equal(user.Id, await reset);

            await using var check = database.CreateContext();
            var finalVersion = await new EfAuthStore(check).GetSessionVersionAsync(user.Id, Ct);
            Assert.Equal(1, finalVersion);
            Assert.False(await check.RefreshTokens.AnyAsync(t => t.UserId == user.Id && t.RevokedAt == null, Ct),
                $"round {round}: a refresh token from the old password survived the reset");
            if (issuedVersion is { } version)
            {
                Assert.True(version < finalVersion, $"round {round}: the access token version {version} is still current");
            }
        }
    }

    private static async Task<AuthUser> CreateUserAsync(EfAuthStore store)
    {
        var user = new AuthUser(Guid.CreateVersion7(), $"sv.{Guid.NewGuid():N}@example.org", OldHash, "Pamuk",
            ActorRole.User, DateTimeOffset.UtcNow, null);
        Assert.True(await store.TryCreateUserAsync(user, null, null, Ct));
        return user;
    }

    private static async Task<string> IssueResetCodeAsync(EfAuthStore store, Guid userId, DateTimeOffset now)
    {
        var code = RefreshTokens.NewToken();
        await store.StoreEmailTokenAsync(new EmailTokenRecord(Guid.CreateVersion7(), userId, RefreshTokens.Hash(code),
            EmailTokenRecord.PasswordReset, now, now + AuthHandlers.PasswordResetLifetime), Ct);
        return code;
    }

    private static RefreshTokenRecord Refresh(Guid userId)
    {
        var now = DateTimeOffset.UtcNow;
        return new RefreshTokenRecord(Guid.CreateVersion7(), userId, Guid.CreateVersion7(),
            RefreshTokens.Hash(RefreshTokens.NewToken()), now, now.AddDays(30), null, null);
    }
}
