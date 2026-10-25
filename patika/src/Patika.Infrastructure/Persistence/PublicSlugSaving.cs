using Microsoft.EntityFrameworkCore;
using Npgsql;
using Patika.Domain.Entities;

namespace Patika.Infrastructure.Persistence;

/// <summary>Raised when a public slug kept colliding with concurrent inserts after every retry.</summary>
public sealed class SlugConflictException(Exception inner)
    : Exception("A unique public address could not be assigned; try again.", inner);

/// <summary>
/// Slugs are chosen check-then-insert in <see cref="PublicDataPreparation"/>, so two requests creating
/// the same name in the same district at the same moment can pick the same slug. The loser hits the
/// unique index; this clears the new slugs and saves again, which picks the next free suffix now that
/// the winner's row is visible.
/// </summary>
public static class PublicSlugSaving
{
    public const int MaxAttempts = 3;

    private static readonly string[] SlugIndexes = ["IX_adoption_posts_slug", "IX_care_places_slug"];

    public static async Task<int> SaveChangesWithSlugRetryAsync(this PatikaDbContext db, CancellationToken ct = default)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException exception) when (IsSlugConflict(exception))
            {
                if (attempt >= MaxAttempts) throw new SlugConflictException(exception);
                foreach (var entry in db.ChangeTracker.Entries().Where(e => e.State == EntityState.Added))
                {
                    if (entry.Entity is AdoptionPost post) post.Slug = "";
                    else if (entry.Entity is CarePlace place) place.Slug = "";
                }
            }
        }
    }

    public static bool IsSlugConflict(DbUpdateException exception) => exception.InnerException is PostgresException
    {
        SqlState: PostgresErrorCodes.UniqueViolation,
    } postgres && SlugIndexes.Contains(postgres.ConstraintName, StringComparer.Ordinal);
}
