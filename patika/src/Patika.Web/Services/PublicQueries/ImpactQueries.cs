using Microsoft.EntityFrameworkCore;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;

namespace Patika.Web.Services.PublicQueries;

public sealed class ImpactQueries(PatikaDbContext db, TimeProvider clock) : IImpactQueries
{
    public const string MethodNote = "Avrupa/İstanbul saatinde tamamlanan ISO haftaları: beslenme kayıtları, yeni istasyonlar, sahiplendirildi olarak kapatılan ilanlar ve bu haftalarda açılıp yardım ulaştı durumuna geçen acil çağrılar sayılır. Gizlenen acil çağrılar sayılmaz.";

    public async Task<ImpactSummary> GetAsync(CancellationToken ct = default)
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById("Europe/Istanbul");
        var local = TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zone);
        var monday = DateOnly.FromDateTime(local.DateTime).AddDays(-(((int)local.DayOfWeek + 6) % 7));
        var weeks = new List<ImpactWeek>();
        for (var offset = -4; offset < 0; offset++)
        {
            var date = monday.AddDays(offset * 7);
            var start = new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue), zone.GetUtcOffset(date.ToDateTime(TimeOnly.MinValue))).ToUniversalTime();
            var end = start.AddDays(7);
            weeks.Add(new ImpactWeek(date,
                await db.Feedings.CountAsync(f => f.At >= start && f.At < end, ct),
                await db.Stations.CountAsync(s => s.CreatedAt >= start && s.CreatedAt < end, ct),
                await db.AdoptionPosts.CountAsync(p => p.ClosedReason == AdoptionClosedReason.Adopted && p.AdoptedAt >= start && p.AdoptedAt < end, ct),
                await db.UrgentPosts.CountAsync(p => p.CreatedAt >= start && p.CreatedAt < end && p.State == UrgentPostState.Handled, ct)));
        }
        return new ImpactSummary(weeks, weeks[^1], MethodNote);
    }
}
