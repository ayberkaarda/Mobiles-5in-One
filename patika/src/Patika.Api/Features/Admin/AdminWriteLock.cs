using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;

namespace Patika.Api.Features.Admin;

/// <summary>
/// Serializes administrative writes and every change that can reduce the number of active admins
/// (role change, suspension, account deletion) behind one PostgreSQL transaction advisory lock.
/// </summary>
public static class AdminWriteLock
{
    public const long Key = 740409;

    public static async Task<IDbContextTransaction> BeginAsync(PatikaDbContext db, CancellationToken ct)
    {
        var tx = await db.Database.BeginTransactionAsync(ct);
        await AcquireAsync(db, ct);
        return tx;
    }

    /// <summary>Call inside an open transaction; the lock is released when it ends.</summary>
    public static Task AcquireAsync(PatikaDbContext db, CancellationToken ct) =>
        db.Database.ExecuteSqlAsync($"SELECT pg_advisory_xact_lock({Key})", ct);

    // Suspended or deactivated admins cannot act, so they never count towards keeping one admin.
    public static bool IsActiveAdmin(User user, DateTimeOffset now) => user.Role == UserRole.Admin && user.DeactivatedAt is null
        && !(user.SuspendedUntil > now);

    public static Task<int> ActiveAdminsAsync(PatikaDbContext db, DateTimeOffset now, CancellationToken ct) =>
        db.Users.CountAsync(u => u.Role == UserRole.Admin && u.DeactivatedAt == null
            && (u.SuspendedUntil == null || u.SuspendedUntil <= now), ct);

    /// <summary>True when removing <paramref name="user"/> from the admins would leave none active.</summary>
    public static async Task<bool> IsLastActiveAdminAsync(PatikaDbContext db, User user, DateTimeOffset now, CancellationToken ct) =>
        IsActiveAdmin(user, now) && await ActiveAdminsAsync(db, now, ct) <= 1;
}
