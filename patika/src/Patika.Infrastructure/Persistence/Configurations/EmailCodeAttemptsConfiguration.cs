using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Patika.Domain.Entities;

namespace Patika.Infrastructure.Persistence.Configurations;

/// <summary>
/// Wrong-guess counter for six-digit email codes (<c>email_tokens.failed_attempts</c>), kept as a
/// shadow property so the domain entity stays unchanged. A code is burned (used_at set) at the limit.
/// </summary>
public sealed class EmailCodeAttemptsConfiguration : IEntityTypeConfiguration<EmailToken>
{
    public const string FailedAttempts = "FailedAttempts";

    public void Configure(EntityTypeBuilder<EmailToken> entity)
    {
        entity.Property<int>(FailedAttempts).HasColumnType("integer").IsRequired().HasDefaultValue(0);
        // At most one live (unused) code per user and purpose; issuance invalidates the previous one.
        entity.HasIndex(row => new { row.UserId, row.Purpose })
            .IsUnique()
            .HasFilter("used_at IS NULL")
            .HasDatabaseName("ux_email_tokens_live_code");
        entity.ToTable("email_tokens", table => table.HasCheckConstraint(
            "ck_email_tokens_failed_attempts", "failed_attempts BETWEEN 0 AND 5"));
    }
}
