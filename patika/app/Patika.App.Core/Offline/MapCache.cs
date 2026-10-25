using System.Text.Json;
using Patika.App.Core.Api;
using Patika.Contracts.Community;

namespace Patika.App.Core.Offline;

public sealed record CachedRegion(MapArea Area, MapFilter? Filter, IReadOnlyList<MapFeature> Features, DateTimeOffset SavedAt);

public sealed record CachedStation(StationDetail Detail, DateTimeOffset SavedAt);

/// <summary>Limits of the offline map cache.</summary>
public sealed class MapCacheOptions
{
    /// <summary>Stations kept for offline detail; the least recently saved are dropped first.</summary>
    public int MaxStations { get; init; } = 300;

    /// <summary>Anything older is evicted: a week-old "last fed" is worse than nothing.</summary>
    public TimeSpan MaxAge { get; init; } = TimeSpan.FromDays(7);
}

/// <summary>
/// The last viewed map region (one slot) and the station details seen recently, so the map opens
/// offline (canvas "Cevrimdisi": the last region is shown). Eviction runs on every save.
/// Saved regions are widened to a 0.01 degree grid (about 1 km), and callers never save a viewport derived
/// from the user's position, so the cache does not reveal where the user is.
/// Writers pass the <see cref="Epoch"/> they read before fetching; <see cref="ClearAsync"/> moves the epoch
/// under the same lock, so a response arriving after sign-out cannot write wiped data back.
/// </summary>
public sealed class MapCache(OfflineDatabase database, TimeProvider clock, MapCacheOptions? options = null)
{
    /// <summary>Grid the saved viewport is widened to.</summary>
    public const double RegionGrid = 0.01;

    private readonly MapCacheOptions limits = options ?? new MapCacheOptions();
    private readonly SemaphoreSlim writes = new(1, 1);
    private long epoch;

    /// <summary>Read before a fetch whose result will be cached; changes when the cache is wiped.</summary>
    public long Epoch => Interlocked.Read(ref epoch);

    /// <summary>Saves the viewport, widened to <see cref="RegionGrid"/>, unless the cache was wiped since <paramref name="readEpoch"/>.</summary>
    public Task<bool> SaveRegionAsync(long readEpoch, MapArea area, MapFilter? filter, IReadOnlyList<MapFeature> features,
        CancellationToken ct = default) =>
        WriteAsync(readEpoch, () => WriteRegionAsync(Snap(area), filter, features, ct), ct);

    /// <summary>Saves a station detail unless the cache was wiped since <paramref name="readEpoch"/>.</summary>
    public Task<bool> SaveStationAsync(long readEpoch, StationDetail detail, CancellationToken ct = default) =>
        WriteAsync(readEpoch, () => WriteStationAsync(detail, ct), ct);

    /// <summary>Widens a viewport outward to whole grid cells.</summary>
    public static MapArea Snap(MapArea area) => area with
    {
        MinLatitude = Math.Round(Math.Floor(Math.Round(area.MinLatitude / RegionGrid, 6)) * RegionGrid, 2),
        MinLongitude = Math.Round(Math.Floor(Math.Round(area.MinLongitude / RegionGrid, 6)) * RegionGrid, 2),
        MaxLatitude = Math.Round(Math.Ceiling(Math.Round(area.MaxLatitude / RegionGrid, 6)) * RegionGrid, 2),
        MaxLongitude = Math.Round(Math.Ceiling(Math.Round(area.MaxLongitude / RegionGrid, 6)) * RegionGrid, 2),
    };

    private async Task<bool> WriteAsync(long readEpoch, Func<Task> write, CancellationToken ct)
    {
        await writes.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            if (readEpoch != Epoch)
            {
                return false;
            }

            await write().ConfigureAwait(false);
            return true;
        }
        finally
        {
            writes.Release();
        }
    }

    private async Task WriteRegionAsync(MapArea area, MapFilter? filter, IReadOnlyList<MapFeature> features, CancellationToken ct)
    {
        await using var connection = await database.OpenAsync(ct).ConfigureAwait(false);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO map_region (slot, area, filter, features, saved_at) VALUES (1, $area, $filter, $features, $saved)
            ON CONFLICT (slot) DO UPDATE SET area = excluded.area, filter = excluded.filter,
                features = excluded.features, saved_at = excluded.saved_at;
            """;
        command.Parameters.AddWithValue("$area", JsonSerializer.Serialize(area, ApiJson.Options));
        command.Parameters.AddWithValue("$filter", filter is null ? DBNull.Value : JsonSerializer.Serialize(filter, ApiJson.Options));
        command.Parameters.AddWithValue("$features", JsonSerializer.Serialize(features, ApiJson.Options));
        command.Parameters.AddWithValue("$saved", clock.GetUtcNow().ToUnixTimeMilliseconds());
        await command.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }

    /// <summary>The last region, or null when none was saved or it is older than <see cref="MapCacheOptions.MaxAge"/>.</summary>
    public async Task<CachedRegion?> GetLastRegionAsync(CancellationToken ct = default)
    {
        await using var connection = await database.OpenAsync(ct).ConfigureAwait(false);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT area, filter, features, saved_at FROM map_region WHERE slot = 1 AND saved_at >= $oldest;";
        command.Parameters.AddWithValue("$oldest", Oldest());
        await using var reader = await command.ExecuteReaderAsync(ct).ConfigureAwait(false);
        if (!await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            return null;
        }

        var area = JsonSerializer.Deserialize<MapArea>(reader.GetString(0), ApiJson.Options)!;
        var filter = reader.IsDBNull(1) ? null : JsonSerializer.Deserialize<MapFilter>(reader.GetString(1), ApiJson.Options);
        var features = JsonSerializer.Deserialize<List<MapFeature>>(reader.GetString(2), ApiJson.Options) ?? [];
        return new CachedRegion(area, filter, features, DateTimeOffset.FromUnixTimeMilliseconds(reader.GetInt64(3)));
    }

    private async Task WriteStationAsync(StationDetail detail, CancellationToken ct)
    {
        await using var connection = await database.OpenAsync(ct).ConfigureAwait(false);
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = """
                INSERT INTO station_cache (id, body, saved_at) VALUES ($id, $body, $saved)
                ON CONFLICT (id) DO UPDATE SET body = excluded.body, saved_at = excluded.saved_at;
                """;
            command.Parameters.AddWithValue("$id", detail.Station.Id.ToString());
            command.Parameters.AddWithValue("$body", JsonSerializer.Serialize(detail, ApiJson.Options));
            command.Parameters.AddWithValue("$saved", clock.GetUtcNow().ToUnixTimeMilliseconds());
            await command.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }

        await EvictAsync(connection, ct).ConfigureAwait(false);
    }

    public async Task<CachedStation?> GetStationAsync(Guid id, CancellationToken ct = default)
    {
        await using var connection = await database.OpenAsync(ct).ConfigureAwait(false);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT body, saved_at FROM station_cache WHERE id = $id AND saved_at >= $oldest;";
        command.Parameters.AddWithValue("$id", id.ToString());
        command.Parameters.AddWithValue("$oldest", Oldest());
        await using var reader = await command.ExecuteReaderAsync(ct).ConfigureAwait(false);
        if (!await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            return null;
        }

        var detail = JsonSerializer.Deserialize<StationDetail>(reader.GetString(0), ApiJson.Options)!;
        return new CachedStation(detail, DateTimeOffset.FromUnixTimeMilliseconds(reader.GetInt64(1)));
    }

    public async Task<int> CountStationsAsync(CancellationToken ct = default)
    {
        await using var connection = await database.OpenAsync(ct).ConfigureAwait(false);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT count(*) FROM station_cache;";
        return Convert.ToInt32(await command.ExecuteScalarAsync(ct).ConfigureAwait(false), System.Globalization.CultureInfo.InvariantCulture);
    }

    /// <summary>Drops rows past <see cref="MapCacheOptions.MaxAge"/> and stations beyond <see cref="MapCacheOptions.MaxStations"/>.</summary>
    public async Task EvictAsync(CancellationToken ct = default)
    {
        await using var connection = await database.OpenAsync(ct).ConfigureAwait(false);
        await EvictAsync(connection, ct).ConfigureAwait(false);
    }

    /// <summary>Removes everything and invalidates writes already in flight; used on sign-out.</summary>
    public async Task ClearAsync(CancellationToken ct = default)
    {
        await writes.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            Interlocked.Increment(ref epoch);
            await using var connection = await database.OpenAsync(ct).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = "DELETE FROM map_region; DELETE FROM station_cache;";
            await command.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }
        finally
        {
            writes.Release();
        }
    }

    private async Task EvictAsync(Microsoft.Data.Sqlite.SqliteConnection connection, CancellationToken ct)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = """
            DELETE FROM map_region WHERE saved_at < $oldest;
            DELETE FROM station_cache WHERE saved_at < $oldest;
            DELETE FROM station_cache WHERE id NOT IN (
                SELECT id FROM station_cache ORDER BY saved_at DESC, rowid DESC LIMIT $max);
            """;
        command.Parameters.AddWithValue("$oldest", Oldest());
        command.Parameters.AddWithValue("$max", limits.MaxStations);
        await command.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }

    private long Oldest() => (clock.GetUtcNow() - limits.MaxAge).ToUnixTimeMilliseconds();
}
