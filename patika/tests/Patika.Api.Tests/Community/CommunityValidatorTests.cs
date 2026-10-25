using Patika.Api.Features.Animals;
using Patika.Api.Features.Stations;
using Patika.Contracts.Community;
using Patika.Contracts.Geo;
using Xunit;

namespace Patika.Api.Tests.Community;

public sealed class CommunityValidatorTests
{
    private static readonly CoordinateDto Istanbul = new(41.01, 28.97);

    [Theory]
    [InlineData(35.79, 29)]
    [InlineData(42.21, 29)]
    [InlineData(41, 25.59)]
    [InlineData(41, 44.91)]
    [InlineData(double.NaN, 29)]
    [InlineData(41, double.PositiveInfinity)]
    public void CreationRejectsCoordinatesOutsideTurkey(double latitude, double longitude)
    {
        var point = new CoordinateDto(latitude, longitude);
        Assert.False(new StationRequestValidator().Validate(new StationRequest(point, "Food", "Cat", "station/a.jpg")).IsValid);
        Assert.False(new AnimalRequestValidator().Validate(new AnimalRequest(point, "Cat", "Unknown", "Healthy")).IsValid);
    }

    [Theory]
    [InlineData("", "Cat")]
    [InlineData("0", "Cat")]
    [InlineData("food", "Cat")]
    [InlineData("Food", "3")]
    [InlineData("Food", "bird")]
    public void StationRejectsUnknownEnumNames(string kind, string species) =>
        Assert.False(new StationRequestValidator().Validate(new StationRequest(Istanbul, kind, species, "station/a.jpg")).IsValid);

    [Theory]
    [InlineData("Cat", "0", "Healthy")]
    [InlineData("Cat", "Unknown", "0")]
    [InlineData("bird", "Unknown", "Healthy")]
    public void AnimalRejectsUnknownEnumNames(string species, string sex, string status) =>
        Assert.False(new AnimalRequestValidator().Validate(new AnimalRequest(Istanbul, species, sex, status)).IsValid);

    [Theory]
    [InlineData("")]
    [InlineData("28,41,29,42")]
    [InlineData("29,41,28,40")]
    [InlineData("NaN,41,29,42")]
    [InlineData("28,41,29")]
    public void RejectsInvalidOrOversizedMapBounds(string bbox) =>
        Assert.False(new MapQueryValidator().Validate(new MapQuery { Bbox = bbox }).IsValid);

    [Theory]
    [InlineData(-1, 1, 10)]
    [InlineData(23, 1, 10)]
    [InlineData(14, 0, 10)]
    [InlineData(14, 1, 501)]
    public void RejectsMapZoomAndPaginationOutsideLimits(int zoom, int page, int pageSize) =>
        Assert.False(new MapQueryValidator().Validate(new MapQuery { Bbox = "28.96,41,28.98,41.02", Zoom = zoom, Page = page, PageSize = pageSize }).IsValid);

    [Theory]
    [InlineData("../a.jpg")]
    [InlineData("https://example.org/a.jpg")]
    [InlineData("/a.jpg")]
    [InlineData("a\nb.jpg")]
    public void RejectsUnsafePhotoKeys(string key)
    {
        Assert.False(new StationRequestValidator().Validate(new StationRequest(Istanbul, "Food", "Cat", key)).IsValid);
        Assert.False(new FeedingRequestValidator().Validate(new FeedingRequest(key)).IsValid);
        Assert.False(new AnimalPhotoRequestValidator().Validate(new AnimalPhotoRequest(key)).IsValid);
    }

    [Fact]
    public void RejectsOversizedAndControlCharacterText()
    {
        Assert.False(new FeedingRequestValidator().Validate(new FeedingRequest(Note: new string('a', 2001))).IsValid);
        Assert.False(new SightingRequestValidator().Validate(new SightingRequest("a\u202eb")).IsValid);
        Assert.False(new StationUpdateRequestValidator().Validate(new StationUpdateRequest(Name: new string('a', 201))).IsValid);
        Assert.False(new AnimalUpdateRequestValidator().Validate(new AnimalUpdateRequest(Name: new string('a', 101))).IsValid);
        Assert.False(new AnimalRequestValidator().Validate(new AnimalRequest(Istanbul, "Cat", "Unknown", "Healthy", StationId: Guid.Empty)).IsValid);
    }

    [Fact]
    public void BirthYearIsOptionalAndBoundedFrom1990ToThisYear()
    {
        var thisYear = (short)DateTimeOffset.UtcNow.ToOffset(TimeSpan.FromHours(3)).Year;
        foreach (short? year in new short?[] { null, 1990, 2015, thisYear })
        {
            Assert.True(new AnimalRequestValidator().Validate(new AnimalRequest(Istanbul, "Cat", "Unknown", "Healthy", BirthYear: year)).IsValid);
            Assert.True(new AnimalUpdateRequestValidator().Validate(new AnimalUpdateRequest(BirthYear: year)).IsValid);
        }

        foreach (short year in new short[] { 0, 1989, (short)(thisYear + 1), short.MaxValue, -5 })
        {
            Assert.False(new AnimalRequestValidator().Validate(new AnimalRequest(Istanbul, "Cat", "Unknown", "Healthy", BirthYear: year)).IsValid);
            Assert.False(new AnimalUpdateRequestValidator().Validate(new AnimalUpdateRequest(BirthYear: year)).IsValid);
        }
    }

    [Fact]
    public void AcceptsValidRequestsAndOptionalNotes()
    {
        Assert.True(new StationRequestValidator().Validate(new StationRequest(Istanbul, "Both", "Mixed", "station/a.jpg")).IsValid);
        Assert.True(new AnimalRequestValidator().Validate(new AnimalRequest(Istanbul, "Cat", "Unknown", "Healthy")).IsValid);
        Assert.True(new StationUpdateRequestValidator().Validate(new StationUpdateRequest()).IsValid);
        Assert.True(new AnimalUpdateRequestValidator().Validate(new AnimalUpdateRequest()).IsValid);
        Assert.True(new FeedingRequestValidator().Validate(new FeedingRequest()).IsValid);
        Assert.True(new SightingRequestValidator().Validate(new SightingRequest()).IsValid);
        Assert.True(new MapQueryValidator().Validate(new MapQuery { Bbox = "28.96,41,28.98,41.02" }).IsValid);
        Assert.True(new PageQueryValidator().Validate(new PageQuery()).IsValid);
    }

    [Fact]
    public void VolunteerEventsExposeNoPositionOrUserIdentity()
    {
        foreach (var type in new[] { typeof(FeedingRequest), typeof(SightingRequest), typeof(FeedingResponse), typeof(SightingResponse) })
        {
            Assert.DoesNotContain(type.GetProperties(), p => p.Name is "Location" or "Latitude" or "Longitude" or "UserId");
        }
    }
}
