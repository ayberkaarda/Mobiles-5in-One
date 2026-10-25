using Patika.App.Core.Map;
using Patika.Contracts.Community;
using Patika.Contracts.Geo;
using Xunit;

namespace Patika.App.Tests.Stations;

public sealed class StationTextTests
{
    private static readonly TimeZoneInfo Istanbul = TimeZoneInfo.CreateCustomTimeZone("TRT", TimeSpan.FromHours(3), "TRT", "TRT");
    private static readonly DateTimeOffset Now = new(2026, 10, 25, 9, 0, 0, TimeSpan.Zero); // 12.00 in Istanbul

    private static DateTimeOffset Local(int day, int hour, int minute) => new(2026, 10, day, hour, minute, 0, TimeSpan.FromHours(3));

    [Theory]
    [InlineData(7, 40, "ta", "tan")] // kırk
    [InlineData(8, 22, "de", "den")] // iki
    [InlineData(19, 15, "te", "ten")] // beş
    [InlineData(9, 0, "da", "dan")] // dokuz
    [InlineData(10, 30, "da", "dan")] // otuz
    [InlineData(6, 13, "te", "ten")] // üç
    [InlineData(6, 16, "da", "dan")] // altı
    [InlineData(8, 0, "de", "den")] // sekiz
    [InlineData(10, 0, "da", "dan")] // on
    [InlineData(20, 50, "de", "den")] // elli
    [InlineData(14, 4, "te", "ten")] // dört
    public void Clock_suffixes_follow_how_the_time_is_read_aloud(int hour, int minute, string locative, string ablative)
    {
        var time = Local(25, hour, minute);
        Assert.Equal(locative, StationText.Locative(time));
        Assert.Equal(ablative, StationText.Ablative(time));
    }

    [Fact]
    public void Last_fed_reads_today_yesterday_or_a_date_in_istanbul_time()
    {
        Assert.Equal("Bugün 07.40’ta beslendi", StationText.LastFed(Local(25, 7, 40), Now, Istanbul));
        Assert.Equal("Dün 19.15’te beslendi", StationText.LastFed(Local(24, 19, 15), Now, Istanbul));
        Assert.Equal("3 Ekim günü beslendi", StationText.LastFed(Local(3, 8, 0), Now, Istanbul));
        Assert.Equal("Henüz beslenmedi", StationText.LastFed(null, Now, Istanbul));

        // 23.30 UTC on the 24th is already the 25th in Istanbul.
        Assert.True(StationText.IsToday(new DateTimeOffset(2026, 10, 24, 23, 30, 0, TimeSpan.Zero), Now, Istanbul));
        Assert.Equal("07.40", StationText.FeedingDay(Local(25, 7, 40), Now, Istanbul));
        Assert.Equal("Dün", StationText.FeedingDay(Local(24, 7, 40), Now, Istanbul));
    }

    [Fact]
    public void Summary_and_author_match_the_canvas()
    {
        var station = new StationResponse(Guid.NewGuid(), "Moda Cad.", new CoordinateDto(40.98, 29.02), "Both", "Cat", "station/x", "Active", null, 312);

        Assert.Equal("Kedi istasyonu, mama ve su. 312 besleme kaydı.", StationText.Summary(station));
        Assert.Equal("Sen", StationText.Author(new FeedingResponse(Guid.NewGuid(), Now, null, null, IsMine: true, "Ayşe")));
        Assert.Equal("Ayşe", StationText.Author(new FeedingResponse(Guid.NewGuid(), Now, null, null, IsMine: false, "Ayşe")));
    }
}
