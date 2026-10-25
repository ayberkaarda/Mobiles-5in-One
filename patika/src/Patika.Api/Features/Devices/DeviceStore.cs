using Microsoft.EntityFrameworkCore;
using Npgsql;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;

namespace Patika.Api.Features.Devices;

public sealed record UrgentSettings(bool OptIn, GeoPoint? HomeArea, int RadiusMeters);

public enum DeviceRegistration
{
    Registered,
    TokenInUse,
}

/// <summary>Push registrations and the urgent-help opt-in of the signed-in user.</summary>
public interface IDeviceStore
{
    /// <summary>
    /// Registers the token for the installation. A token already held by a different installation is
    /// refused (<see cref="DeviceRegistration.TokenInUse"/>); the same installation may move to another
    /// account. Keeps at most <paramref name="maxPerUser"/> registrations per user, dropping the oldest.
    /// </summary>
    Task<DeviceRegistration> RegisterAsync(Guid userId, Guid installationId, string token, StoreEnvironment environment,
        DateTimeOffset now, int maxPerUser, CancellationToken cancellationToken);

    /// <summary>Removes the token only when the user owns it.</summary>
    Task UnregisterAsync(Guid userId, string token, CancellationToken cancellationToken);

    Task<UrgentSettings?> GetUrgentSettingsAsync(Guid userId, CancellationToken cancellationToken);

    Task SetUrgentSettingsAsync(Guid userId, UrgentSettings settings, CancellationToken cancellationToken);
}

/// <summary>
/// Store over <c>device_tokens</c> (with <c>installation_id</c>) and the urgent columns of <c>users</c>
/// (<c>urgent_home</c> is a rounded saved area, never a live position). All SQL is interpolated (parameterized).
/// </summary>
public sealed class EfDeviceStore(PatikaDbContext db) : IDeviceStore
{
    public async Task<DeviceRegistration> RegisterAsync(Guid userId, Guid installationId, string token, StoreEnvironment environment,
        DateTimeOffset now, int maxPerUser, CancellationToken cancellationToken)
    {
        var utc = now.ToUniversalTime();
        var env = environment.ToString();
        var userLock = "devices:user:" + userId.ToString("D");
        var installationLock = "devices:installation:" + installationId.ToString("D");
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            // Per-user lock first (keeps insert + prune atomic against the cap), then per installation.
            await db.Database.ExecuteSqlAsync($"SELECT pg_advisory_xact_lock(hashtextextended({userLock}, 0))", cancellationToken);
            await db.Database.ExecuteSqlAsync($"SELECT pg_advisory_xact_lock(hashtextextended({installationLock}, 0))", cancellationToken);
            var holders = await db.Database.SqlQuery<Guid>($"""
                SELECT installation_id AS "Value" FROM device_tokens WHERE token = {token}
                """).ToListAsync(cancellationToken);
            if (holders.Any(holder => holder != installationId))
            {
                // Knowing someone's token is not enough to take it over: only its own installation may move it.
                return DeviceRegistration.TokenInUse;
            }

            var updated = await db.Database.ExecuteSqlAsync($"""
                UPDATE device_tokens SET user_id = {userId}, token = {token}, environment = {env},
                    last_seen_at = {utc}, updated_at = {utc}
                WHERE installation_id = {installationId}
                """, cancellationToken);
            if (updated == 0)
            {
                await db.Database.ExecuteSqlAsync($"""
                    INSERT INTO device_tokens (id, user_id, installation_id, token, environment, last_seen_at, created_at, updated_at)
                    VALUES ({Guid.CreateVersion7()}, {userId}, {installationId}, {token}, {env}, {utc}, {utc}, {utc})
                    """, cancellationToken);
            }

            await db.Database.ExecuteSqlAsync($"""
                DELETE FROM device_tokens WHERE id IN (
                    SELECT id FROM device_tokens WHERE user_id = {userId}
                    ORDER BY last_seen_at DESC, id DESC OFFSET {maxPerUser})
                """, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return DeviceRegistration.Registered;
        }
        catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return DeviceRegistration.TokenInUse;
        }
    }

    public Task UnregisterAsync(Guid userId, string token, CancellationToken cancellationToken) =>
        db.DeviceTokens.Where(d => d.UserId == userId && d.Token == token).ExecuteDeleteAsync(cancellationToken);

    public async Task<UrgentSettings?> GetUrgentSettingsAsync(Guid userId, CancellationToken cancellationToken)
    {
        var rows = await db.Database.SqlQuery<SettingsRow>($"""
            SELECT urgent_opt_in AS "OptIn", urgent_radius_m AS "RadiusMeters",
                ST_Y(urgent_home::geometry) AS "Latitude", ST_X(urgent_home::geometry) AS "Longitude"
            FROM users WHERE id = {userId}
            """).ToListAsync(cancellationToken);
        if (rows is not [var row])
        {
            return null;
        }

        var home = row.Latitude is { } lat && row.Longitude is { } lng ? new GeoPoint(lng, lat) : (GeoPoint?)null;
        return new UrgentSettings(row.OptIn, home, row.RadiusMeters);
    }

    public async Task SetUrgentSettingsAsync(Guid userId, UrgentSettings settings, CancellationToken cancellationToken)
    {
        double? lat = settings.HomeArea?.Latitude;
        double? lng = settings.HomeArea?.Longitude;
        await db.Database.ExecuteSqlAsync($"""
            UPDATE users SET urgent_opt_in = {settings.OptIn}, urgent_radius_m = {settings.RadiusMeters},
                urgent_home = CASE WHEN {lat}::double precision IS NULL THEN NULL
                    ELSE ST_SetSRID(ST_MakePoint({lng}::double precision, {lat}::double precision), 4326)::geography END,
                updated_at = now()
            WHERE id = {userId}
            """, cancellationToken);
    }

    private sealed record SettingsRow(bool OptIn, int RadiusMeters, double? Latitude, double? Longitude);
}
