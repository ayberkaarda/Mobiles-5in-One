using Patika.Domain;
using Xunit;

namespace Patika.Domain.Tests;

public sealed class SlugTests
{
    [Theory]
    [InlineData("Kadıköy", "kadikoy")]
    [InlineData("ÇAĞLAYAN  Sk.", "caglayan-sk")]
    [InlineData("Üsküdar", "uskudar")]
    [InlineData("Beşiktaş", "besiktas")]
    [InlineData("İSTANBUL IĞDIR", "istanbul-igdir")]
    [InlineData("🐾🐈", "x")]
    [InlineData("", "x")]
    [InlineData("-- a 🐾 b --", "a-b")]
    [InlineData("Kâğıthane", "kagithane")]
    [InlineData("Kadıköy", "kadikoy")]
    public void FoldsTurkishAndSeparators(string source, string expected) => Assert.Equal(expected, Slug.From(source));

    [Fact]
    public void LimitsLengthAndTrimsATruncatedSeparator()
    {
        Assert.Equal(new string('a', 80), Slug.From(new string('a', 200)));
        Assert.Equal(new string('a', 79), Slug.From(new string('a', 79) + "  b"));
    }
}
