using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Patika.Api.Features.Account;
using Patika.Api.Features.Auth;
using Patika.Api.Security.Tokens;
using Patika.Contracts.Media;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;
using Patika.Worker.Jobs.Accounts;
using Testcontainers.PostgreSql;
using Xunit;

namespace Patika.SecurityTests.Account;

public sealed class AccountDatabaseFixture : IAsyncLifetime
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
        await db.Database.MigrateAsync();
    }

    public async ValueTask DisposeAsync() => await container.DisposeAsync();

    public PatikaDbContext CreateContext() => new(new DbContextOptionsBuilder<PatikaDbContext>()
        .UseNpgsql(ConnectionString, postgres => postgres.UseNetTopologySuite())
        .Options);
}

/// <summary>
/// End to end over a real database: request deletion, let the grace period pass, run the
/// <c>deletion.hard_delete</c> purge, then scan every column of every table for the user's data.
/// </summary>
public sealed class HardDeleteLeavesNoPersonalDataTests(AccountDatabaseFixture database) : IClassFixture<AccountDatabaseFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task NoRowAnywhereHoldsTheDeletedUsersDataAndHistoryIsAnonymised()
    {
        var target = await SeedPersonAsync("hedef");
        var bystander = await SeedPersonAsync("komsu");
        var now = DateTimeOffset.UtcNow;

        await using (var db = database.CreateContext())
        {
            var schedule = await new EfAccountDeletionStore(db).RequestDeletionAsync(target.UserId, now, TimeSpan.FromDays(7), Ct);
            Assert.True(schedule!.Created);
        }

        var queue = new RecordingRemovalQueue();
        await using (var db = database.CreateContext())
        {
            // Inside the grace period nothing is purged.
            Assert.Equal(0, await Purger(db, queue, now.AddDays(6)).PurgeDueAsync(Ct));
            Assert.Equal(1, await Purger(db, queue, now.AddDays(7).AddMinutes(1)).PurgeDueAsync(Ct));
            Assert.Equal(0, await Purger(db, queue, now.AddDays(7).AddMinutes(2)).PurgeDueAsync(Ct));
        }

        var rows = await AllRowsAsync();
        foreach (var marker in target.Markers)
        {
            Assert.DoesNotContain(rows, row => row.Json.Contains(marker, StringComparison.OrdinalIgnoreCase));
        }

        // The bystander is untouched, which also proves the scan can see this kind of data.
        foreach (var marker in bystander.Markers)
        {
            Assert.Contains(rows, row => row.Json.Contains(marker, StringComparison.OrdinalIgnoreCase));
        }

        Assert.Equal(target.PhotoKeys.Order(StringComparer.Ordinal), queue.Keys.Order(StringComparer.Ordinal));

        await using var check = database.CreateContext();
        var tombstone = await check.Users.AsNoTracking().SingleAsync(u => u.Id == target.UserId, Ct);
        Assert.Null(tombstone.Email);
        Assert.Null(tombstone.PasswordHash);
        Assert.Null(tombstone.AppleSub);
        Assert.Null(tombstone.District);
        Assert.Null(tombstone.TotpSecretEnc);
        Assert.Equal(AccountPurger.DeletedDisplayName, tombstone.DisplayName);
        Assert.NotNull(tombstone.DeactivatedAt);
        Assert.Null(tombstone.UrgentHome);
        Assert.False(tombstone.UrgentOptIn);
        Assert.Equal(AccountPurger.DefaultUrgentRadiusM, tombstone.UrgentRadiusM);
        Assert.False(await check.Uploads.AnyAsync(u => u.UserId == target.UserId, Ct));
        var keptStation = await check.Stations.AsNoTracking().SingleAsync(s => s.Id == target.StationId, Ct);
        Assert.Equal("", keptStation.PhotoKey);

        Assert.Equal(target.FeedingCount, await check.Feedings.CountAsync(f => f.StationId == target.StationId && f.UserId == null, Ct));
        Assert.True(await check.Sightings.AnyAsync(s => s.AnimalId == target.AnimalId && s.UserId == null, Ct));
        Assert.Equal(1L, (await check.Stations.AsNoTracking().SingleAsync(s => s.Id == target.StationId, Ct)).FeedingsCount);
        Assert.False(await check.Subscriptions.AnyAsync(s => s.UserId == target.UserId, Ct));
        Assert.True(await check.Subscriptions.AnyAsync(s => s.OriginalTransactionIdHash == target.TransactionHash, Ct));

        foreach (var (table, column) in UserColumns)
        {
            Assert.DoesNotContain(rows, row => row.Table == table && row.Json.Contains(
                $"\"{column}\":\"{target.UserId}\"", StringComparison.Ordinal));
        }

        var request = await check.DeletionRequests.AsNoTracking().SingleAsync(r => r.UserId == target.UserId, Ct);
        Assert.NotNull(request.CompletedAt);
        var audit = await check.AuditLogs.AsNoTracking()
            .SingleAsync(a => a.Action == AccountPurgeAuditActions.HardDeleted && a.TargetId == target.UserId, Ct);
        Assert.Null(audit.ActorId);
        Assert.Null(audit.DetailsJson);
    }

    [Fact]
    public void EveryPhysicalObjectOfAPhotoIsTargeted()
    {
        var key = MediaKeys.PhotoKey("station", Guid.CreateVersion7());

        Assert.Equal(
            [$"incoming/{key}", $"quarantine/{key}", $"media/{key}.webp", $"media/{key}_800.webp", $"media/{key}_320.webp"],
            PhotoObjects.For(key, [800, 320]));
    }

    [Fact]
    public async Task ACancelledRequestIsNeverPurged()
    {
        var person = await SeedPersonAsync("vazgecen");
        var now = DateTimeOffset.UtcNow;
        await using (var db = database.CreateContext())
        {
            await new EfAccountDeletionStore(db).RequestDeletionAsync(person.UserId, now, TimeSpan.FromDays(7), Ct);
            Assert.True(await new EfAuthStore(db).TryCancelPendingDeletionAsync(person.UserId, now.AddDays(1), Ct));
        }

        await using (var db = database.CreateContext())
        {
            await Purger(db, new RecordingRemovalQueue(), now.AddDays(30)).PurgeDueAsync(Ct);
            var user = await db.Users.AsNoTracking().SingleAsync(u => u.Id == person.UserId, Ct);
            Assert.Equal(person.Email, user.Email);
            Assert.Null(user.DeactivatedAt);
        }
    }

    [Fact]
    public async Task UnverifiedAccountsOlderThanSevenDaysAreRemoved()
    {
        await using var db = database.CreateContext();
        var stale = NewUser("eski", verified: false);
        var fresh = NewUser("yeni", verified: false);
        var verified = NewUser("dogrulanmis", verified: true);
        var external = NewUser("harici", verified: false);
        db.Users.AddRange(stale, fresh, verified, external);
        await db.SaveChangesAsync(Ct);
        db.ExternalLogins.Add(new ExternalLogin { Provider = "google", Subject = $"sub-{Guid.NewGuid():N}", UserId = external.Id });
        db.EmailTokens.Add(new EmailToken
        {
            UserId = stale.Id,
            TokenHash = RefreshTokens.Hash(RefreshTokens.NewToken()),
            Purpose = EmailTokenRecord.VerifyEmail,
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(-7),
        });
        await db.SaveChangesAsync(Ct);
        db.ChangeTracker.Clear();
        var old = DateTimeOffset.UtcNow.AddDays(-8);
        await db.Users.Where(u => u.Id == stale.Id || u.Id == verified.Id || u.Id == external.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.CreatedAt, old), Ct);

        var cleaner = new UnverifiedAccountCleaner(db, TimeProvider.System, NullLogger<UnverifiedAccountCleaner>.Instance);
        Assert.Equal(1, await cleaner.RemoveStaleAsync(Ct));

        Assert.False(await db.Users.AnyAsync(u => u.Id == stale.Id, Ct));
        Assert.False(await db.EmailTokens.AnyAsync(t => t.UserId == stale.Id, Ct));
        Assert.True(await db.Users.AnyAsync(u => u.Id == fresh.Id, Ct));
        Assert.True(await db.Users.AnyAsync(u => u.Id == verified.Id, Ct));
        Assert.True(await db.Users.AnyAsync(u => u.Id == external.Id, Ct));
    }

    private static readonly (string Table, string Column)[] UserColumns =
    [
        ("external_logins", "user_id"), ("refresh_tokens", "user_id"), ("email_tokens", "user_id"),
        ("device_tokens", "user_id"), ("follows", "user_id"), ("feedings", "user_id"), ("sightings", "user_id"),
        ("adoption_requests", "requester_id"), ("adoption_posts", "created_by"), ("urgent_posts", "created_by"),
        ("animal_photos", "created_by"), ("reports", "reporter_id"), ("subscriptions", "user_id"), ("uploads", "user_id"),
    ];

    private AccountPurger Purger(PatikaDbContext db, IObjectKeyRemovalQueue queue, DateTimeOffset at) =>
        new(db, queue, new FixedClock(at), NullLogger<AccountPurger>.Instance);

    private async Task<Person> SeedPersonAsync(string label)
    {
        var tag = $"{label}{Guid.NewGuid():N}"[..20];
        await using var db = database.CreateContext();
        var user = NewUser(tag, verified: true);
        user.District = $"Semt-{tag}";
        user.AppleSub = $"apple-{tag}";
        user.TotpSecretEnc = $"totp-{tag}";
        user.UrgentOptIn = true;
        user.UrgentRadiusM = 1234;
        user.UrgentHome = new GeoPoint(28.9 + (Random.Shared.NextDouble() / 10), 41.0 + (Random.Shared.NextDouble() / 10));
        var helper = NewUser($"yardimci{Guid.NewGuid():N}", verified: true);
        db.Users.AddRange(user, helper);
        await db.SaveChangesAsync(Ct);

        var uploads = new[] { "station", "feeding", "animal", "urgent", "feeding", "animal" }
            .Select((kind, index) =>
            {
                var id = Guid.CreateVersion7();
                return new Upload
                {
                    Id = id,
                    UserId = user.Id,
                    Kind = kind,
                    Key = MediaKeys.PhotoKey(kind, id),
                    ContentType = "image/jpeg",
                    ContentLength = 1000 + index,
                    // The last two were never attached to anything: one still pending, one quarantined.
                    State = index switch { 4 => "pending", 5 => "quarantined", _ => "processed" },
                    FailureCode = index == 5 ? "decode_failed" : null,
                };
            })
            .ToArray();
        db.Uploads.AddRange(uploads);
        await db.SaveChangesAsync(Ct);
        var (stationKey, feedingKey, animalKey, urgentKey) = (uploads[0].Key, uploads[1].Key, uploads[2].Key, uploads[3].Key);

        var station = new Station { Location = new GeoPoint(29.02, 41.01), PhotoKey = stationKey, CreatedBy = user.Id, FeedingsCount = 1 };
        var animal = new Animal { Location = new GeoPoint(29.03, 41.02), Name = "Pamuk", CreatedBy = helper.Id };
        db.Stations.Add(station);
        db.Animals.Add(animal);
        await db.SaveChangesAsync(Ct);

        var post = new AdoptionPost
        {
            AnimalId = animal.Id,
            CreatedBy = user.Id,
            Description = $"ilan-{tag}",
            Requirements = $"kosul-{tag}",
            District = "Kadıköy",
            State = AdoptionPostState.Published,
            ClosesAt = DateTimeOffset.UtcNow.AddDays(30),
        };
        var helperPost = new AdoptionPost
        {
            AnimalId = animal.Id,
            CreatedBy = helper.Id,
            Description = "Yardımcının ilanı",
            Requirements = "Yok",
            District = "Moda",
            State = AdoptionPostState.Published,
            ClosesAt = DateTimeOffset.UtcNow.AddDays(30),
        };
        db.AdoptionPosts.AddRange(post, helperPost);
        await db.SaveChangesAsync(Ct);

        var refresh = RefreshTokens.Hash(RefreshTokens.NewToken());
        var transactionHash = Convert.ToHexString(RefreshTokens.Hash(tag));
        db.AddRange(
            new ExternalLogin { Provider = "google", Subject = $"google-{tag}", UserId = user.Id },
            new RefreshToken { UserId = user.Id, FamilyId = Guid.CreateVersion7(), TokenHash = refresh, ExpiresAt = DateTimeOffset.UtcNow.AddDays(30) },
            new EmailToken { UserId = user.Id, TokenHash = RefreshTokens.Hash(RefreshTokens.NewToken()), Purpose = EmailTokenRecord.PasswordReset, ExpiresAt = DateTimeOffset.UtcNow.AddHours(1) },
            new DeviceToken { UserId = user.Id, Token = $"apns-{tag}", InstallationId = Guid.NewGuid(), LastSeenAt = DateTimeOffset.UtcNow },
            new Follow { UserId = user.Id, AnimalId = animal.Id },
            new Feeding { StationId = station.Id, UserId = user.Id, At = DateTimeOffset.UtcNow, PhotoKey = feedingKey, Note = $"mama-{tag}" },
            new Feeding { StationId = station.Id, UserId = user.Id, At = DateTimeOffset.UtcNow, Note = $"su-{tag}" },
            new Sighting { AnimalId = animal.Id, UserId = user.Id, At = DateTimeOffset.UtcNow, Note = $"gordum-{tag}" },
            new AnimalPhoto { AnimalId = animal.Id, Key = animalKey, CreatedBy = user.Id },
            // Hidden by moderation: the purge must still find it, past the default urgent visibility filter.
            new UrgentPost { Location = new GeoPoint(29.04, 41.03), Description = $"acil-{tag}", PhotoKey = urgentKey, CreatedBy = user.Id, HiddenAt = DateTimeOffset.UtcNow, HiddenReason = $"gizli-{tag}" },
            new AdoptionRequest { PostId = helperPost.Id, RequesterId = user.Id, Message = $"talep-{tag}" },
            new AdoptionRequest { PostId = post.Id, RequesterId = helper.Id, Message = $"gelen-{tag}" },
            new Report { TargetType = "station", TargetId = station.Id, ReporterId = user.Id, Reason = $"sikayet-{tag}" },
            new Subscription { UserId = user.Id, OriginalTransactionIdHash = transactionHash, ProductId = "patika.destek.aylik", ExpiresAt = DateTimeOffset.UtcNow.AddDays(30) });
        await db.SaveChangesAsync(Ct);

        // The stored urgent home exactly as row_to_json renders it (hex EWKB), so the scan can look for it.
        string urgentHome;
        await using (var connection = new NpgsqlConnection(database.ConnectionString))
        {
            await connection.OpenAsync(Ct);
            await using var read = new NpgsqlCommand("SELECT row_to_json(u)->>'urgent_home' FROM users u WHERE id = @id", connection);
            read.Parameters.AddWithValue("id", user.Id);
            urgentHome = (string)(await read.ExecuteScalarAsync(Ct))!;
        }

        var photoKeys = uploads.Select(u => u.Key).ToArray();
        string[] markers =
        [
            user.Email!, tag, user.DisplayName, user.District, user.AppleSub, user.TotpSecretEnc, user.PasswordHash!,
            $"google-{tag}", $"apns-{tag}", Convert.ToHexString(refresh).ToLowerInvariant(), urgentHome,
            .. photoKeys,
        ];
        return new Person(user.Id, user.Email!, station.Id, animal.Id, markers, photoKeys, 2, transactionHash);
    }

    private static User NewUser(string tag, bool verified) => new()
    {
        Email = $"{tag}@example.org",
        EmailVerifiedAt = verified ? DateTimeOffset.UtcNow : null,
        PasswordHash = $"$argon2id$v=19$m=65536,t=3,p=1${tag}",
        DisplayName = $"Gönüllü {tag}",
    };

    /// <summary>Every row of every table as JSON text, read with plain ADO.NET (table names come from the catalog).</summary>
    private async Task<List<(string Table, string Json)>> AllRowsAsync()
    {
        await using var connection = new NpgsqlConnection(database.ConnectionString);
        await connection.OpenAsync(Ct);
        var tables = new List<string>();
        await using (var list = new NpgsqlCommand(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' "
            + "AND table_name NOT IN ('spatial_ref_sys')", connection))
        await using (var reader = await list.ExecuteReaderAsync(Ct))
        {
            while (await reader.ReadAsync(Ct))
            {
                tables.Add(reader.GetString(0));
            }
        }

        Assert.Contains("users", tables);
        var rows = new List<(string, string)>();
        foreach (var table in tables)
        {
            var quoted = "\"" + table.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
            await using var select = new NpgsqlCommand($"SELECT row_to_json(t)::text FROM {quoted} t", connection);
            await using var reader = await select.ExecuteReaderAsync(Ct);
            while (await reader.ReadAsync(Ct))
            {
                rows.Add((table, reader.GetString(0)));
            }
        }

        return rows;
    }

    private sealed record Person(
        Guid UserId, string Email, Guid StationId, Guid AnimalId, string[] Markers, string[] PhotoKeys, int FeedingCount,
        string TransactionHash);

    private sealed class RecordingRemovalQueue : IObjectKeyRemovalQueue
    {
        public List<string> Keys { get; } = [];

        public Task EnqueueAsync(IReadOnlyCollection<string> keys, CancellationToken cancellationToken)
        {
            Keys.AddRange(keys);
            return Task.CompletedTask;
        }
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
