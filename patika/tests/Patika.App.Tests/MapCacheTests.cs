using Patika.App.Core.Api;
using Patika.App.Core.Offline;
using Patika.Contracts.Community;
using Patika.Contracts.Geo;
using Xunit;

namespace Patika.App.Tests;

public sealed class MapCacheTests : IDisposable
{
    private readonly TempDatabase db = new();
    private readonly ManualClock clock = new();

    public void Dispose() => db.Dispose();

    private static StationDetail Station(Guid id, string name) => new(
        new StationResponse(id, name, new CoordinateDto(40.985, 29.025), "Food", "Cat", "stations/a.webp", "Active", null, 3),
        [new FeedingResponse(Guid.NewGuid(), DateTimeOffset.UnixEpoch, null, "su")]);

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task The_last_region_round_trips_and_is_replaced_by_the_next()
    {
        var cache = new MapCache(db.Database, clock);
        var moda = new MapArea(40.98, 29.02, 40.99, 29.03, 15);
        var feature = new MapFeature(Guid.NewGuid(), 40.985, 29.025, 1);

        await cache.SaveRegionAsync(cache.Epoch, moda, new MapFilter(Species: "Cat"), [feature], Ct);
        var saved = await cache.GetLastRegionAsync(Ct);
        await cache.SaveRegionAsync(cache.Epoch, moda with { Zoom = 16 }, null, [], Ct);
        var replaced = await cache.GetLastRegionAsync(Ct);

        Assert.NotNull(saved);
        Assert.Equal(moda, saved.Area);
        Assert.Equal("Cat", saved.Filter?.Species);
        Assert.Equal(feature, Assert.Single(saved.Features));
        Assert.Equal(16, replaced!.Area.Zoom);
        Assert.Empty(replaced.Features);
    }

    [Fact]
    public async Task A_saved_viewport_is_widened_to_the_coarse_grid()
    {
        var cache = new MapCache(db.Database, clock);
        // A viewport whose centre would be a precise point (40.98712, 29.02655).
        var precise = new MapArea(40.98312, 29.02155, 40.99112, 29.03155, 15);

        await cache.SaveRegionAsync(cache.Epoch, precise, null, [], Ct);
        var saved = (await cache.GetLastRegionAsync(Ct))!.Area;

        Assert.Equal(new MapArea(40.98, 29.02, 41.00, 29.04, 15), saved);
    }

    [Fact]
    public async Task A_write_started_before_a_wipe_is_dropped()
    {
        var cache = new MapCache(db.Database, clock);
        var id = Guid.NewGuid();
        var epochBeforeFetch = cache.Epoch;

        await cache.ClearAsync(Ct); // sign-out while the fetch was in flight
        var regionWritten = await cache.SaveRegionAsync(epochBeforeFetch, new MapArea(40.98, 29.02, 40.99, 29.03, 15), null, [], Ct);
        var stationWritten = await cache.SaveStationAsync(epochBeforeFetch, Station(id, "Moda"), Ct);

        Assert.False(regionWritten);
        Assert.False(stationWritten);
        Assert.Null(await cache.GetLastRegionAsync(Ct));
        Assert.Null(await cache.GetStationAsync(id, Ct));
        Assert.True(await cache.SaveStationAsync(cache.Epoch, Station(id, "Moda"), Ct));
    }

    [Fact]
    public async Task Stations_beyond_the_limit_are_evicted_oldest_first()
    {
        var cache = new MapCache(db.Database, clock, new MapCacheOptions { MaxStations = 3 });
        var ids = Enumerable.Range(0, 5).Select(_ => Guid.NewGuid()).ToArray();
        for (var i = 0; i < ids.Length; i++)
        {
            await cache.SaveStationAsync(cache.Epoch, Station(ids[i], $"İstasyon {i}"), Ct);
            clock.Advance(TimeSpan.FromMinutes(1));
        }

        Assert.Equal(3, await cache.CountStationsAsync(Ct));
        Assert.Null(await cache.GetStationAsync(ids[0], Ct));
        Assert.Null(await cache.GetStationAsync(ids[1], Ct));
        Assert.Equal("İstasyon 4", (await cache.GetStationAsync(ids[4], Ct))?.Detail.Station.Name);
    }

    [Fact]
    public async Task Saving_a_station_again_refreshes_its_place()
    {
        var cache = new MapCache(db.Database, clock, new MapCacheOptions { MaxStations = 2 });
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();
        var c = Guid.NewGuid();

        await cache.SaveStationAsync(cache.Epoch, Station(a, "A"), Ct);
        clock.Advance(TimeSpan.FromMinutes(1));
        await cache.SaveStationAsync(cache.Epoch, Station(b, "B"), Ct);
        clock.Advance(TimeSpan.FromMinutes(1));
        await cache.SaveStationAsync(cache.Epoch, Station(a, "A2"), Ct);
        clock.Advance(TimeSpan.FromMinutes(1));
        await cache.SaveStationAsync(cache.Epoch, Station(c, "C"), Ct);

        Assert.Equal("A2", (await cache.GetStationAsync(a, Ct))?.Detail.Station.Name);
        Assert.Null(await cache.GetStationAsync(b, Ct));
    }

    [Fact]
    public async Task Entries_older_than_the_max_age_are_not_served_and_are_evicted()
    {
        var cache = new MapCache(db.Database, clock, new MapCacheOptions { MaxAge = TimeSpan.FromDays(7) });
        var id = Guid.NewGuid();
        await cache.SaveRegionAsync(cache.Epoch, new MapArea(40.98, 29.02, 40.99, 29.03, 15), null, [], Ct);
        await cache.SaveStationAsync(cache.Epoch, Station(id, "Moda"), Ct);

        clock.Advance(TimeSpan.FromDays(7) + TimeSpan.FromMinutes(1));

        Assert.Null(await cache.GetLastRegionAsync(Ct));
        Assert.Null(await cache.GetStationAsync(id, Ct));
        await cache.EvictAsync(Ct);
        Assert.Equal(0, await cache.CountStationsAsync(Ct));
    }

    [Fact]
    public async Task Clear_removes_everything()
    {
        var cache = new MapCache(db.Database, clock);
        await cache.SaveRegionAsync(cache.Epoch, new MapArea(40.98, 29.02, 40.99, 29.03, 15), null, [], Ct);
        await cache.SaveStationAsync(cache.Epoch, Station(Guid.NewGuid(), "Moda"), Ct);

        await cache.ClearAsync(Ct);

        Assert.Null(await cache.GetLastRegionAsync(Ct));
        Assert.Equal(0, await cache.CountStationsAsync(Ct));
    }
}
