using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using NetTopologySuite.Geometries;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence.Configurations;

namespace Patika.Infrastructure.Persistence;

public class PatikaDbContext(DbContextOptions<PatikaDbContext> options) : DbContext(options)
{
    public DbSet<Province> Provinces => Set<Province>();
    public DbSet<TotpRecoveryCode> TotpRecoveryCodes => Set<TotpRecoveryCode>();
    public DbSet<AdminAccessToken> AdminAccessTokens => Set<AdminAccessToken>();
    public DbSet<CarePlaceImport> CarePlaceImports => Set<CarePlaceImport>();
    public DbSet<District> Districts => Set<District>();
    public DbSet<ModerationDecision> ModerationDecisions => Set<ModerationDecision>();
    public DbSet<ExternalLogin> ExternalLogins => Set<ExternalLogin>();
    public DbSet<Upload> Uploads => Set<Upload>();
    public DbSet<PushDailyCounter> PushDailyCounters => Set<PushDailyCounter>();
    public DbSet<User> Users => Set<User>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<EmailToken> EmailTokens => Set<EmailToken>();
    public DbSet<Station> Stations => Set<Station>();
    public DbSet<Feeding> Feedings => Set<Feeding>();
    public DbSet<Animal> Animals => Set<Animal>();
    public DbSet<AnimalPhoto> AnimalPhotos => Set<AnimalPhoto>();
    public DbSet<Sighting> Sightings => Set<Sighting>();
    public DbSet<Follow> Follows => Set<Follow>();
    public DbSet<AdoptionPost> AdoptionPosts => Set<AdoptionPost>();
    public DbSet<AdoptionRequest> AdoptionRequests => Set<AdoptionRequest>();
    public DbSet<UrgentPost> UrgentPosts => Set<UrgentPost>();
    public DbSet<CarePlace> CarePlaces => Set<CarePlace>();
    public DbSet<DeviceToken> DeviceTokens => Set<DeviceToken>();
    public DbSet<Subscription> Subscriptions => Set<Subscription>();
    public DbSet<AppStoreNotification> AppStoreNotifications => Set<AppStoreNotification>();
    public DbSet<Report> Reports => Set<Report>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<DeletionRequest> DeletionRequests => Set<DeletionRequest>();
    public DbSet<IdempotencyKey> IdempotencyKeys => Set<IdempotencyKey>();

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        configurationBuilder.Properties<GeoPoint>().HaveConversion<GeoPointConverter>();
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasPostgresExtension("postgis");
        ConfigureEntity<TotpRecoveryCode>(modelBuilder, "totp_recovery_codes");
        ConfigureEntity<AdminAccessToken>(modelBuilder, "admin_access_tokens");
        ConfigureEntity<CarePlaceImport>(modelBuilder, "care_place_imports");
        AdminConfiguration.Configure(modelBuilder);
        ConfigureEntity<Province>(modelBuilder, "provinces");
        ConfigureEntity<District>(modelBuilder, "districts");
        ConfigureEntity<ModerationDecision>(modelBuilder, "moderation_decisions");
        ConfigureEntity<User>(modelBuilder, "users");
        Phase4Configuration.Configure(modelBuilder);
        ConfigureEntity<Upload>(modelBuilder, "uploads");
        ConfigureEntity<ExternalLogin>(modelBuilder, "external_logins");
        ConfigureEntity<RefreshToken>(modelBuilder, "refresh_tokens");
        ConfigureEntity<EmailToken>(modelBuilder, "email_tokens");
        ConfigureEntity<Station>(modelBuilder, "stations");
        ConfigureEntity<Feeding>(modelBuilder, "feedings");
        ConfigureEntity<Animal>(modelBuilder, "animals");
        ConfigureEntity<AnimalPhoto>(modelBuilder, "animal_photos");
        ConfigureEntity<Sighting>(modelBuilder, "sightings");
        ConfigureEntity<Follow>(modelBuilder, "follows");
        ConfigureEntity<AdoptionPost>(modelBuilder, "adoption_posts");
        ConfigureEntity<AdoptionRequest>(modelBuilder, "adoption_requests");
        ConfigureEntity<UrgentPost>(modelBuilder, "urgent_posts");
        ConfigureEntity<CarePlace>(modelBuilder, "care_places");
        ConfigureEntity<DeviceToken>(modelBuilder, "device_tokens");
        ConfigureEntity<Subscription>(modelBuilder, "subscriptions");
        ConfigureEntity<AppStoreNotification>(modelBuilder, "app_store_notifications");
        ConfigureEntity<Report>(modelBuilder, "reports");
        ConfigureEntity<AuditLog>(modelBuilder, "audit_logs");
        ConfigureEntity<DeletionRequest>(modelBuilder, "deletion_requests");

        modelBuilder.Entity<User>().HasIndex(user => user.Email).IsUnique();
        modelBuilder.Entity<User>().HasIndex(user => user.AppleSub).IsUnique();
        modelBuilder.Entity<Follow>().HasIndex(follow => new { follow.UserId, follow.AnimalId }).IsUnique();
        modelBuilder.Entity<DeviceToken>().HasIndex(token => token.Token).IsUnique();
        modelBuilder.Entity<AppStoreNotification>().HasIndex(notification => notification.NotificationUuid).IsUnique();
        ConfigureLocation(modelBuilder.Entity<Station>());
        ConfigureLocation(modelBuilder.Entity<Animal>());
        ConfigureLocation(modelBuilder.Entity<UrgentPost>());
        ConfigureLocation(modelBuilder.Entity<CarePlace>());
        modelBuilder.Entity<CarePlace>().Property(place => place.HoursJson).HasColumnType("jsonb");
        modelBuilder.Entity<AuditLog>().Property(log => log.DetailsJson).HasColumnType("jsonb");

        modelBuilder.ApplyConfigurationsFromAssembly(typeof(PatikaDbContext).Assembly);

        foreach (var entityType in modelBuilder.Model.GetEntityTypes())
        {
            foreach (var property in entityType.GetProperties())
            {
                property.SetColumnName(ToSnakeCase(property.Name));
                if ((Nullable.GetUnderlyingType(property.ClrType) ?? property.ClrType).IsEnum)
                {
                    modelBuilder.Entity(entityType.ClrType)
                        .Property(property.Name).HasConversion<string>();
                }
            }
        }
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        PreparePublicData();
        StampChanges();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(
        bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        PreparePublicData();
        StampChanges();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    private void PreparePublicData() => PublicDataPreparation.Prepare(this);

    private void StampChanges()
    {
        ChangeTracker.DetectChanges();
        var now = DateTimeOffset.UtcNow;
        foreach (var entry in ChangeTracker.Entries<Entity>())
        {
            if (entry.State == EntityState.Added)
            {
                if (entry.Entity.Id == Guid.Empty)
                {
                    entry.Entity.Id = Guid.CreateVersion7();
                }

                entry.Entity.CreatedAt = now;
                entry.Entity.UpdatedAt = now;
            }
            else if (entry.State == EntityState.Modified)
            {
                entry.Property(row => row.CreatedAt).IsModified = false;
                entry.Entity.UpdatedAt = now;
            }
        }
    }

    private static void ConfigureEntity<T>(ModelBuilder modelBuilder, string tableName)
        where T : Entity
    {
        var entity = modelBuilder.Entity<T>();
        entity.HasBaseType((Type?)null);
        entity.ToTable(tableName);
        entity.HasKey(row => row.Id);
        entity.Property(row => row.Id).HasValueGenerator<Uuid7ValueGenerator>();

    }

    private static void ConfigureLocation<T>(EntityTypeBuilder<T> entity) where T : Entity
    {
        entity.Property<GeoPoint>("Location").HasColumnType("geography(Point,4326)");
        entity.HasIndex("Location").HasMethod("gist");
    }

    private static string ToSnakeCase(string name) =>
        string.Concat(name.Select((character, index) =>
            char.IsUpper(character) && index > 0
                ? "_" + char.ToLowerInvariant(character)
                : char.ToLowerInvariant(character).ToString()));
}

public sealed class GeoPointConverter() : ValueConverter<GeoPoint, Point>(
    location => new Point(location.Longitude, location.Latitude) { SRID = 4326 },
    point => new GeoPoint(point.X, point.Y))
{ }
