using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Patika.Domain.Entities;

namespace Patika.Infrastructure.Persistence;

public sealed class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> entity)
    {
        entity.Property(row => row.Email).HasMaxLength(320);
        entity.Property(row => row.PasswordHash).HasMaxLength(512);
        entity.Property(row => row.SessionVersion).HasColumnType("integer").IsRequired().HasDefaultValue(0);
        entity.Property(row => row.AppleSub).HasMaxLength(255);
        entity.Property(row => row.DisplayName).HasMaxLength(100);
        entity.Property(row => row.District).HasMaxLength(100);
        entity.Property(row => row.UrgentHome).HasColumnType("geography(Point,4326)");
        entity.HasIndex(row => row.UrgentHome).HasDatabaseName("ix_users_urgent_home")
            .HasMethod("gist").HasFilter("urgent_opt_in");
        entity.ToTable("users", table => table.HasCheckConstraint(
            "ck_users_urgent_radius", "urgent_radius_m BETWEEN 500 AND 2000"));
    }
}

public sealed class RefreshTokenConfiguration : IEntityTypeConfiguration<RefreshToken>
{
    public void Configure(EntityTypeBuilder<RefreshToken> entity)
    {
        entity.Property(row => row.TokenHash).HasColumnType("bytea").IsRequired();
        entity.HasIndex(row => row.TokenHash).IsUnique();
        entity.HasIndex(row => row.UserId);
        entity.HasIndex(row => row.FamilyId);
        entity.HasIndex(row => row.ExpiresAt);
        entity.HasOne<User>().WithMany().HasForeignKey(row => row.UserId).OnDelete(DeleteBehavior.Cascade);
        entity.HasOne<RefreshToken>().WithMany().HasForeignKey(row => row.ReplacedById).OnDelete(DeleteBehavior.SetNull);
        entity.ToTable("refresh_tokens", table => table.HasCheckConstraint(
            "ck_refresh_tokens_hash_length", "octet_length(token_hash) = 32"));
    }
}

public sealed class EmailTokenConfiguration : IEntityTypeConfiguration<EmailToken>
{
    public void Configure(EntityTypeBuilder<EmailToken> entity)
    {
        entity.Property(row => row.TokenHash).HasColumnType("bytea").IsRequired();
        entity.Property(row => row.Purpose).HasMaxLength(50);
        entity.HasIndex(row => row.TokenHash).IsUnique();
        entity.HasIndex(row => row.ExpiresAt);
        entity.HasOne<User>().WithMany().HasForeignKey(row => row.UserId).OnDelete(DeleteBehavior.Cascade);
        entity.ToTable("email_tokens", table => table.HasCheckConstraint(
            "ck_email_tokens_hash_length", "octet_length(token_hash) = 32"));
    }
}

public sealed class ExternalLoginConfiguration : IEntityTypeConfiguration<ExternalLogin>
{
    public void Configure(EntityTypeBuilder<ExternalLogin> entity)
    {
        entity.Property(row => row.Provider).HasMaxLength(50);
        entity.Property(row => row.Subject).HasMaxLength(255);
        entity.HasIndex(row => new { row.Provider, row.Subject }).IsUnique();
        entity.HasOne<User>().WithMany().HasForeignKey(row => row.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class StationConfiguration : IEntityTypeConfiguration<Station>
{
    public void Configure(EntityTypeBuilder<Station> entity)
    {
        entity.Property(row => row.District).HasMaxLength(60);
        entity.Property(row => row.Name).HasMaxLength(200);
        entity.Property(row => row.PhotoKey).HasMaxLength(512);
        entity.HasOne<User>().WithMany().HasForeignKey(row => row.CreatedBy).OnDelete(DeleteBehavior.Restrict);
        entity.HasIndex(row => new { row.Status, row.Kind, row.Species });
        entity.ToTable("stations", table => table.HasCheckConstraint("ck_stations_feedings_count", "feedings_count >= 0"));
    }
}

public sealed class FeedingConfiguration : IEntityTypeConfiguration<Feeding>
{
    public void Configure(EntityTypeBuilder<Feeding> entity)
    {
        entity.HasIndex(row => row.UserId).IsUnique(false);
        entity.Property(row => row.PhotoKey).HasMaxLength(512);
        entity.Property(row => row.Note).HasMaxLength(2000);
        entity.HasOne<Station>().WithMany().HasForeignKey(row => row.StationId).OnDelete(DeleteBehavior.Cascade);
        entity.HasOne<User>().WithMany().HasForeignKey(row => row.UserId).OnDelete(DeleteBehavior.SetNull);
        entity.HasIndex(row => new { row.StationId, row.At }).IsDescending(false, true);
    }
}

public sealed class AnimalConfiguration : IEntityTypeConfiguration<Animal>
{
    public void Configure(EntityTypeBuilder<Animal> entity)
    {
        entity.Property(row => row.District).HasMaxLength(60);
        entity.Property(row => row.Name).HasMaxLength(100);
        entity.HasOne<Station>().WithMany().HasForeignKey(row => row.StationId).OnDelete(DeleteBehavior.SetNull);
        entity.HasOne<User>().WithMany().HasForeignKey(row => row.CreatedBy).OnDelete(DeleteBehavior.Restrict);
        entity.HasIndex(row => new { row.Status, row.Species });
    }
}

public sealed class AnimalPhotoConfiguration : IEntityTypeConfiguration<AnimalPhoto>
{
    public void Configure(EntityTypeBuilder<AnimalPhoto> entity)
    {
        entity.HasIndex(row => row.CreatedBy).IsUnique(false);
        entity.Property(row => row.Key).HasMaxLength(512);
        entity.HasOne<Animal>().WithMany().HasForeignKey(row => row.AnimalId).OnDelete(DeleteBehavior.Cascade);
        entity.HasOne<User>().WithMany().HasForeignKey(row => row.CreatedBy).OnDelete(DeleteBehavior.Restrict);
        entity.HasIndex(row => row.ModerationState);
    }
}

public sealed class SightingConfiguration : IEntityTypeConfiguration<Sighting>
{
    public void Configure(EntityTypeBuilder<Sighting> entity)
    {
        entity.HasIndex(row => row.UserId).IsUnique(false);
        entity.Property(row => row.Note).HasMaxLength(2000);
        entity.HasOne<Animal>().WithMany().HasForeignKey(row => row.AnimalId).OnDelete(DeleteBehavior.Cascade);
        entity.HasOne<User>().WithMany().HasForeignKey(row => row.UserId).OnDelete(DeleteBehavior.SetNull);
        entity.HasIndex(row => new { row.AnimalId, row.At }).IsDescending(false, true);
    }
}

public sealed class FollowConfiguration : IEntityTypeConfiguration<Follow>
{
    public void Configure(EntityTypeBuilder<Follow> entity)
    {
        entity.HasOne<Animal>().WithMany().HasForeignKey(row => row.AnimalId).OnDelete(DeleteBehavior.Cascade);
        entity.HasOne<User>().WithMany().HasForeignKey(row => row.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class AdoptionPostConfiguration : IEntityTypeConfiguration<AdoptionPost>
{
    public void Configure(EntityTypeBuilder<AdoptionPost> entity)
    {
        entity.Property(row => row.Description).HasMaxLength(10000);
        entity.Property(row => row.Requirements).HasMaxLength(4000);
        entity.Property(row => row.District).HasMaxLength(100);
        entity.HasOne<Animal>().WithMany().HasForeignKey(row => row.AnimalId).OnDelete(DeleteBehavior.Cascade);
        entity.HasOne<User>().WithMany().HasForeignKey(row => row.CreatedBy).OnDelete(DeleteBehavior.Restrict);
        entity.HasIndex(row => new { row.State, row.District });
        entity.HasIndex(row => new { row.State, row.ClosesAt });
    }
}

public sealed class AdoptionRequestConfiguration : IEntityTypeConfiguration<AdoptionRequest>
{
    public void Configure(EntityTypeBuilder<AdoptionRequest> entity)
    {
        entity.HasIndex(row => row.RequesterId).IsUnique(false);
        entity.Property(row => row.Message).HasMaxLength(4000);
        entity.Property(row => row.Reply).HasMaxLength(4000);
        entity.HasOne<AdoptionPost>().WithMany().HasForeignKey(row => row.PostId).OnDelete(DeleteBehavior.Cascade);
        entity.HasOne<User>().WithMany().HasForeignKey(row => row.RequesterId).OnDelete(DeleteBehavior.Cascade);
        entity.HasIndex(row => new { row.PostId, row.State });
    }
}

public sealed class UrgentPostConfiguration : IEntityTypeConfiguration<UrgentPost>
{
    public void Configure(EntityTypeBuilder<UrgentPost> entity)
    {
        entity.Property(row => row.Description).HasMaxLength(10000);
        entity.Property(row => row.PhotoKey).HasMaxLength(512);
        entity.HasOne<User>().WithMany().HasForeignKey(row => row.CreatedBy).OnDelete(DeleteBehavior.Restrict);
        entity.HasIndex(row => new { row.CreatedBy, row.CreatedAt });
        entity.HasIndex(row => new { row.State, row.CreatedAt });
        entity.Property(row => row.FanoutAt).HasColumnType("timestamptz");
        entity.HasIndex(row => row.CreatedAt).HasDatabaseName("ix_urgent_posts_fanout_pending")
            .HasFilter("fanout_at IS NULL");
        // Backfill existing urgent posts in migration Up() after adding fanout_at:
        // migrationBuilder.Sql("UPDATE urgent_posts SET fanout_at = created_at WHERE fanout_at IS NULL;");
        entity.ToTable("urgent_posts", table => table.HasCheckConstraint(
            "ck_urgent_posts_notified_count", "notified_count BETWEEN 0 AND 500"));
    }
}

public sealed class CarePlaceConfiguration : IEntityTypeConfiguration<CarePlace>
{
    public void Configure(EntityTypeBuilder<CarePlace> entity)
    {
        entity.Property(row => row.Name).HasMaxLength(200);
        entity.Property(row => row.Address).HasMaxLength(1000);
        entity.Property(row => row.Phone).HasMaxLength(32);
        entity.HasIndex(row => new { row.Kind, row.Open24h });
        entity.ToTable("care_places", table => table.HasCheckConstraint(
            "ck_care_places_sample_label", "NOT is_sample OR name LIKE '[ÖRNEK]%'"));
    }
}

public sealed class DeviceTokenConfiguration : IEntityTypeConfiguration<DeviceToken>
{
    public void Configure(EntityTypeBuilder<DeviceToken> entity)
    {
        entity.Property(row => row.Token).HasMaxLength(512);
        entity.Property(row => row.InstallationId).HasColumnType("uuid").IsRequired();
        // The client supplies the installation ID; each installation has at most one token across all users.
        entity.HasIndex(row => row.InstallationId).IsUnique();
        entity.HasOne<User>().WithMany().HasForeignKey(row => row.UserId).OnDelete(DeleteBehavior.Cascade);
        entity.HasIndex(row => row.LastSeenAt);
    }
}

public sealed class SubscriptionConfiguration : IEntityTypeConfiguration<Subscription>
{
    public void Configure(EntityTypeBuilder<Subscription> entity)
    {
        entity.Property(row => row.OriginalTransactionIdHash).HasMaxLength(64);
        entity.Property(row => row.ProductId).HasMaxLength(255);
        entity.HasIndex(row => new { row.OriginalTransactionIdHash, row.Environment }).IsUnique();
        entity.HasIndex(row => new { row.Status, row.ExpiresAt });
        entity.HasOne<User>().WithMany().HasForeignKey(row => row.UserId).OnDelete(DeleteBehavior.SetNull);
    }
}

public sealed class AppStoreNotificationConfiguration : IEntityTypeConfiguration<AppStoreNotification>
{
    public void Configure(EntityTypeBuilder<AppStoreNotification> entity)
    {
        entity.Property(row => row.Type).HasMaxLength(100);
        entity.Property(row => row.Subtype).HasMaxLength(100);
        entity.HasIndex(row => new { row.ProcessedAt, row.ReceivedAt });
    }
}

public sealed class ReportConfiguration : IEntityTypeConfiguration<Report>
{
    public void Configure(EntityTypeBuilder<Report> entity)
    {
        entity.HasIndex(row => row.ReporterId).IsUnique(false);
        entity.Property(row => row.TargetType).HasMaxLength(50);
        entity.Property(row => row.Reason).HasMaxLength(4000);
        entity.HasOne<User>().WithMany().HasForeignKey(row => row.ReporterId).OnDelete(DeleteBehavior.Cascade);
        entity.HasIndex(row => new { row.TargetType, row.TargetId });
        entity.HasIndex(row => new { row.State, row.CreatedAt });
    }
}

public sealed class AuditLogConfiguration : IEntityTypeConfiguration<AuditLog>
{
    public void Configure(EntityTypeBuilder<AuditLog> entity)
    {
        entity.Property(row => row.Action).HasMaxLength(100);
        entity.Property(row => row.TargetType).HasMaxLength(50);
        entity.HasOne<User>().WithMany().HasForeignKey(row => row.ActorId).OnDelete(DeleteBehavior.SetNull);
        entity.HasIndex(row => new { row.TargetType, row.TargetId });
        entity.HasIndex(row => row.CreatedAt);
    }
}

public sealed class DeletionRequestConfiguration : IEntityTypeConfiguration<DeletionRequest>
{
    public void Configure(EntityTypeBuilder<DeletionRequest> entity)
    {
        entity.HasOne<User>().WithMany().HasForeignKey(row => row.UserId).OnDelete(DeleteBehavior.Cascade);
        entity.HasIndex(row => new { row.CompletedAt, row.CancelledAt, row.ExecuteAfter });
        entity.HasIndex(row => row.UserId).IsUnique()
            .HasFilter("completed_at IS NULL AND cancelled_at IS NULL");
    }
}

public sealed class UploadConfiguration : IEntityTypeConfiguration<Upload>
{
    public void Configure(EntityTypeBuilder<Upload> entity)
    {
        entity.Property(row => row.Kind).HasColumnType("text");
        entity.Property(row => row.Key).HasColumnType("text");
        entity.Property(row => row.ContentType).HasColumnType("text");
        entity.Property(row => row.ContentLength).HasColumnType("bigint");
        entity.Property(row => row.State).HasColumnType("text");
        entity.Property(row => row.FailureCode).HasColumnType("text");
        entity.Property(row => row.ProcessedAt).HasColumnType("timestamptz");
        entity.HasAlternateKey(row => row.Key).HasName("uploads_key_key");
        entity.HasOne<User>().WithMany().HasForeignKey(row => row.UserId).OnDelete(DeleteBehavior.Cascade);
        entity.HasIndex(row => new { row.UserId, row.CreatedAt })
            .HasDatabaseName("ix_uploads_user_id_created_at");
        entity.ToTable("uploads", table => table.HasCheckConstraint(
            "uploads_content_length_check", "content_length BETWEEN 1 AND 5242880"));
    }
}

public sealed class PushDailyCounterConfiguration : IEntityTypeConfiguration<PushDailyCounter>
{
    public void Configure(EntityTypeBuilder<PushDailyCounter> entity)
    {
        entity.ToTable("push_daily_counters");
        entity.HasKey(row => new { row.Day, row.Channel });
        entity.Property(row => row.Day).HasColumnType("date");
        entity.Property(row => row.Channel).HasColumnType("text");
        entity.Property(row => row.Count).HasColumnType("integer").HasDefaultValue(0);
    }
}
