using Microsoft.EntityFrameworkCore;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;

namespace Patika.Api.Features.Adoptions;

public sealed class AdoptionClosureService(PatikaDbContext db)
{
    public async Task<int> CloseAsync(DateTimeOffset now, CancellationToken ct = default)
    {
        var posts = await db.AdoptionPosts.Where(p => p.State != AdoptionPostState.Closed
            && (p.ClosesAt <= now || db.Animals.Any(a => a.Id == p.AnimalId && a.Status == AnimalStatus.Adopted)))
            .ToListAsync(ct);
        foreach (var post in posts)
        {
            var adopted = await db.Animals.AnyAsync(a => a.Id == post.AnimalId && a.Status == AnimalStatus.Adopted, ct);
            await ClosePostAsync(db, post, ct, adopted ? AdoptionClosedReason.Adopted : AdoptionClosedReason.Expired, now);
        }
        await db.SaveChangesAsync(ct);
        return posts.Count;
    }

    internal static async Task ClosePostAsync(PatikaDbContext db, AdoptionPost post, CancellationToken ct,
        AdoptionClosedReason reason = AdoptionClosedReason.Withdrawn, DateTimeOffset? now = null)
    {
        post.State = AdoptionPostState.Closed;
        post.ClosedReason = reason;
        post.AdoptedAt = reason == AdoptionClosedReason.Adopted ? now ?? DateTimeOffset.UtcNow : null;
        var requests = await db.AdoptionRequests.Where(r => r.PostId == post.Id
            && r.State != AdoptionRequestState.Closed).ToListAsync(ct);
        foreach (var request in requests)
        {
            request.State = AdoptionRequestState.Closed;
        }
    }
}
