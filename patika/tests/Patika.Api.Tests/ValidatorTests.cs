using FluentValidation;
using Patika.Api.Features.Auth;
using Patika.Api.Validation;
using Patika.Contracts.Auth;
using Patika.Contracts.Geo;
using Xunit;

namespace Patika.Api.Tests;

public sealed class ValidatorTests
{
    private const string Valid = "mama-kabı-dolu-42";
    private static readonly string ValidRefresh = new('A', 43);

    public static TheoryData<string, string, string, string> RegisterNegatives => new()
    {
        { "empty email", "", Valid, "Pamuk" },
        { "no at sign", "kedi.example.org", Valid, "Pamuk" },
        { "no domain dot", "kedi@localhost", Valid, "Pamuk" },
        { "display form", "Kedi <kedi@example.org>", Valid, "Pamuk" },
        { "padded", " kedi@example.org", Valid, "Pamuk" },
        { "too long email", new string('a', 250) + "@example.org", Valid, "Pamuk" },
        { "control char in email", "ke\u0007di@example.org", Valid, "Pamuk" },
        { "short password", "kedi@example.org", "kisa-9chr", "Pamuk" },
        { "long password", "kedi@example.org", new string('x', 129), "Pamuk" },
        { "empty password", "kedi@example.org", "", "Pamuk" },
        { "empty display name", "kedi@example.org", Valid, "" },
        { "one-char display name", "kedi@example.org", Valid, " a " },
        { "long display name", "kedi@example.org", Valid, new string('b', 61) },
        { "bidi override", "kedi@example.org", Valid, "Pamuk‮txt" },
        { "newline", "kedi@example.org", Valid, "Pamuk\nAdmin" },
    };

    [Theory]
    [MemberData(nameof(RegisterNegatives))]
    public void RegisterRejects(string because, string email, string password, string displayName)
    {
        var result = new RegisterRequestValidator().Validate(new RegisterRequest(email, password, displayName));
        Assert.False(result.IsValid, because);
    }

    [Fact]
    public void RegisterAcceptsValidRequest()
    {
        Assert.True(new RegisterRequestValidator().Validate(new RegisterRequest("kedi@example.org", Valid, "Pamuk Abla")).IsValid);
    }

    [Fact]
    public void RegisterRejectsNullMembers()
    {
        var result = new RegisterRequestValidator().Validate(new RegisterRequest(null!, null!, null!));
        Assert.Equal(["DisplayName", "Email", "Password"], result.Errors.Select(e => e.PropertyName).Distinct().Order());
    }

    [Theory]
    [InlineData("", Valid)]
    [InlineData("kedi@example.org", "")]
    [InlineData("kedi@example.org", "x")]
    public void LoginRejects(string email, string password)
    {
        var tooLong = password == "x" ? new string('x', 129) : password;
        Assert.False(new LoginRequestValidator().Validate(new LoginRequest(email, tooLong)).IsValid);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-jwt")]
    [InlineData("a.b.c.d")]
    public void GoogleRejects(string token)
    {
        Assert.False(new GoogleSignInRequestValidator().Validate(new GoogleSignInRequest(token)).IsValid);
    }

    [Fact]
    public void GoogleRejectsOversizedToken()
    {
        Assert.False(new GoogleSignInRequestValidator().Validate(new GoogleSignInRequest("a." + new string('b', 4100) + ".c")).IsValid);
    }

    [Theory]
    [InlineData("")]
    [InlineData("short")]
    [InlineData("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")]
    [InlineData("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")]
    [InlineData("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'--AAA")]
    public void RefreshAndLogoutRejectMalformedTokens(string token)
    {
        Assert.False(new RefreshRequestValidator().Validate(new RefreshRequest(token)).IsValid);
        Assert.False(new LogoutRequestValidator().Validate(new LogoutRequest(token)).IsValid);
    }

    [Fact]
    public void RefreshAcceptsWellFormedToken()
    {
        Assert.True(new RefreshRequestValidator().Validate(new RefreshRequest(ValidRefresh)).IsValid);
    }

    [Theory]
    [InlineData(40.99, 29.03, true)] // Kadıköy
    [InlineData(39.92, 32.85, true)] // Ankara
    [InlineData(48.85, 2.35, false)] // Paris
    [InlineData(35.17, 33.36, false)] // south of the box
    [InlineData(91, 29, false)]
    [InlineData(41, 181, false)]
    [InlineData(double.NaN, 29, false)]
    [InlineData(41, double.PositiveInfinity, false)]
    public void CoordinatesMustBeValidAndInsideTurkey(double lat, double lng, bool expected)
    {
        Assert.Equal(expected, new CoordinateValidator().Validate(new CoordinateDto(lat, lng)).IsValid);
    }

    [Theory]
    [InlineData(40.98, 29.02, 41.00, 29.05, true)] // a few km² around Moda
    [InlineData(40.90, 28.90, 41.10, 29.20, false)] // ~560 km²
    [InlineData(41.00, 29.05, 40.98, 29.02, false)] // inverted
    [InlineData(40.98, 29.02, 40.98, 29.05, false)] // zero height
    [InlineData(-91, 29.02, 41.00, 29.05, false)]
    public void BoundingBoxAreaIsCapped(double minLat, double minLng, double maxLat, double maxLng, bool expected)
    {
        Assert.Equal(expected, new BoundingBoxValidator().Validate(new BoundingBoxQuery(minLat, minLng, maxLat, maxLng)).IsValid);
    }

    [Theory]
    [InlineData(5000, true)]
    [InlineData(1, true)]
    [InlineData(5001, false)]
    [InlineData(0, false)]
    [InlineData(-10, false)]
    public void RadiusIsAtMostFiveKilometres(int radius, bool expected)
    {
        Assert.Equal(expected, new NearQueryValidator().Validate(new NearQuery(40.99, 29.03, radius)).IsValid);
    }

    [Fact]
    public void EveryRequestDtoHasAValidator()
    {
        var dtoTypes = typeof(RegisterRequest).Assembly.GetTypes()
            .Where(t => t.Namespace == typeof(RegisterRequest).Namespace && t.Name.EndsWith("Request", StringComparison.Ordinal));
        var validated = typeof(RegisterRequestValidator).Assembly.GetTypes()
            .Select(t => t.BaseType)
            .Where(b => b is { IsGenericType: true } && b.GetGenericTypeDefinition() == typeof(AbstractValidator<>))
            .Select(b => b!.GetGenericArguments()[0])
            .ToHashSet();

        Assert.All(dtoTypes, dto => Assert.Contains(dto, validated));
    }
}
