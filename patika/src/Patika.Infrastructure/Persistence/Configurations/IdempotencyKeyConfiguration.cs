using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Patika.Domain.Entities;

namespace Patika.Infrastructure.Persistence.Configurations;

/// <summary>
/// One stored outcome per (user, <c>Idempotency-Key</c>) for offline replays of create requests.
/// <c>RequestHash</c> is SHA-256 over method, path and the bound request; the response is kept for
/// 24 hours so the same key and body replay the original answer.
/// </summary>
public sealed class IdempotencyKey
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public Guid Key { get; set; }

    public required byte[] RequestHash { get; set; }

    public int StatusCode { get; set; }

    public string? ContentType { get; set; }

    public string? Location { get; set; }

    public required byte[] ResponseBody { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class IdempotencyKeyConfiguration : IEntityTypeConfiguration<IdempotencyKey>
{
    public void Configure(EntityTypeBuilder<IdempotencyKey> entity)
    {
        entity.ToTable("idempotency_keys", table =>
        {
            table.HasCheckConstraint("ck_idempotency_keys_hash_length", "octet_length(request_hash) = 32");
            table.HasCheckConstraint("ck_idempotency_keys_body_length", "octet_length(response_body) <= 65536");
        });
        entity.HasKey(row => row.Id);
        entity.Property(row => row.RequestHash).HasColumnType("bytea").IsRequired();
        entity.Property(row => row.ResponseBody).HasColumnType("bytea").IsRequired();
        entity.Property(row => row.ContentType).HasMaxLength(200);
        entity.Property(row => row.Location).HasMaxLength(2048);
        entity.HasIndex(row => new { row.UserId, row.Key }).IsUnique();
        entity.HasIndex(row => row.CreatedAt);
        entity.HasOne<User>().WithMany().HasForeignKey(row => row.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
