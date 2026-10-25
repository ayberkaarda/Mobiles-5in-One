using Microsoft.EntityFrameworkCore;
using Patika.Domain.Entities;

namespace Patika.Infrastructure.Persistence;

internal static class AdminConfiguration
{
    public static void Configure(ModelBuilder model)
    {
        model.Entity<TotpRecoveryCode>().HasIndex(x => x.UserId);
        model.Entity<TotpRecoveryCode>().HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        model.Entity<AdminAccessToken>().HasIndex(x => x.TokenHash).IsUnique();
        model.Entity<AdminAccessToken>().HasIndex(x => x.ExpiresAt);
        model.Entity<AdminAccessToken>().HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        model.Entity<AdminAccessToken>().Property(x => x.Purpose).HasMaxLength(20);
        model.Entity<AdminAccessToken>().Property(x => x.Reason).HasMaxLength(300);
        model.Entity<AdminAccessToken>().Property(x => x.AuthMethod).HasMaxLength(20);
        model.Entity<CarePlaceImport>().HasIndex(x => x.FileHash).IsUnique();
        model.Entity<CarePlaceImport>().Property(x => x.FileHash).HasMaxLength(64);
        model.Entity<AdoptionPost>().HasIndex(x => new { x.State, x.CreatedAt, x.Id });
        model.Entity<AnimalPhoto>().HasIndex(x => new { x.ModerationState, x.CreatedAt, x.Id });
        model.Entity<Report>().HasIndex(x => new { x.State, x.CreatedAt, x.Id });
        model.Entity<UrgentPost>().HasIndex(x => new { x.CreatedAt, x.Id });
        model.Entity<AuditLog>().HasIndex(x => new { x.CreatedAt, x.Id });
    }
}
