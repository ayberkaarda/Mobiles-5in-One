using Microsoft.EntityFrameworkCore;
using Patika.Domain.Entities;

namespace Patika.Infrastructure.Persistence;

internal static class Phase4Configuration
{
    public static void Configure(ModelBuilder model)
    {
        model.Entity<Province>().HasIndex(p => p.Slug).IsUnique();
        model.Entity<District>().HasIndex(d => new { d.ProvinceId, d.Slug }).IsUnique();
        model.Entity<District>().HasOne<Province>().WithMany().HasForeignKey(d => d.ProvinceId).OnDelete(DeleteBehavior.Restrict);
        foreach (var type in new[] { typeof(Station), typeof(Animal), typeof(AdoptionPost), typeof(CarePlace) })
        {
            model.Entity(type).HasOne(typeof(District)).WithMany().HasForeignKey("DistrictId").OnDelete(DeleteBehavior.SetNull);
            model.Entity(type).HasIndex("DistrictId");
        }
        model.Entity<AdoptionPost>().Property(p => p.Slug).HasMaxLength(100);
        model.Entity<AdoptionPost>().HasIndex(p => p.Slug).IsUnique();
        model.Entity<CarePlace>().Property(p => p.Slug).HasMaxLength(100);
        model.Entity<CarePlace>().HasIndex(p => p.Slug).IsUnique();
        model.Entity<CarePlace>().Property(p => p.Website).HasMaxLength(2048);
        model.Entity<CarePlace>().ToTable("care_places", t => t.HasCheckConstraint("ck_care_places_website", "website IS NULL OR website ~ '^https://[^/[:space:]]+'"));
        model.Entity<UrgentPost>().HasQueryFilter(p => p.HiddenAt == null);
        model.Entity<UrgentPost>().Property(p => p.HiddenReason).HasMaxLength(500);
        model.Entity<ModerationDecision>().Property(p => p.TargetType).HasMaxLength(50);
        model.Entity<ModerationDecision>().Property(p => p.Reason).HasMaxLength(500);
        model.Entity<ModerationDecision>().HasIndex(p => new { p.TargetType, p.TargetId, p.DecidedAt });
        model.Entity<Province>().Property(p => p.Name).HasMaxLength(100);
        model.Entity<Province>().Property(p => p.Slug).HasMaxLength(80);
        model.Entity<District>().Property(p => p.Name).HasMaxLength(100);
        model.Entity<District>().Property(p => p.Slug).HasMaxLength(80);
    }
}
