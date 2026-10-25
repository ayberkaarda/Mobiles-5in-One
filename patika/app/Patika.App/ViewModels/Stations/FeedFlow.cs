using Patika.App.Core.Api;
using Patika.App.Core.Map;
using Patika.App.Core.Navigation;
using Patika.App.Core.Offline;

namespace Patika.App.ViewModels.Stations;

/// <summary>What the Beslendi and Bekleme screens show, passed with the navigation.</summary>
public sealed record FeedingVisit(Guid StationId, string StationName, FeedOutcome Outcome, TimeSpan Remaining,
    DateTimeOffset? RecordedAt, bool FromStationPage)
{
    public bool Queued => Outcome is FeedOutcome.Queued or FeedOutcome.AlreadyQueued;
}

/// <summary>The selected station on the map sheet (canvas "Main").</summary>
public sealed record StationCard(Guid Id, string Name, string FedLine, bool FedToday, string Summary, string? District,
    StationDetail Detail)
{
    public static StationCard From(StationDetail detail, DateTimeOffset now)
    {
        var station = detail.Station;
        return new StationCard(station.Id, StationNames.Of(station), StationText.LastFed(station.LastFedAt, now, TimeZoneInfo.Local),
            StationText.IsToday(station.LastFedAt, now, TimeZoneInfo.Local), StationText.Summary(station), station.District, detail);
    }
}

public static class StationNames
{
    public static string Of(Patika.Contracts.Community.StationResponse station) =>
        string.IsNullOrWhiteSpace(station.Name) ? "İstasyon" : station.Name.Trim();
}

/// <summary>
/// "Beslendi" from the map sheet, the station page or the cooldown screen: <see cref="FeedPlanner"/> decides
/// (in Core, tested), this picks the screen: Beslendi for sent and queued (also when a record is already
/// waiting on the phone), Bekleme inside the server's 30 minutes.
/// </summary>
public sealed class FeedFlow(FeedPlanner planner, INavigationService navigation)
{
    public const string VisitKey = "visit";

    /// <param name="replace">From the Bekleme screen: the next screen takes its place instead of stacking on it.</param>
    public async Task FeedAsync(StationDetail detail, bool fromStationPage, bool replace = false)
    {
        var decision = await planner.FeedAsync(detail);
        var visit = new FeedingVisit(detail.Station.Id, StationNames.Of(detail.Station), decision.Outcome, decision.Remaining,
            decision.RecordedAt, fromStationPage);
        var route = decision.Outcome == FeedOutcome.Cooldown ? Routes.Cooldown : Routes.Fed;
        await navigation.GoToAsync(replace ? "../" + route : route, new Dictionary<string, object> { [VisitKey] = visit });
    }
}
