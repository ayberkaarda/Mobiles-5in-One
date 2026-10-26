using Xunit;

namespace Patika.Domain.Tests;

public sealed class UserTextTests
{
    [Theory]
    [InlineData("Yaralı\u202e kedi", "Yaralı kedi")]
    [InlineData("a\u0001b\u007fc\u0085d", "abcd")]
    [InlineData("zero\u200bwidth\u2066iso\u2069", "zerowidthiso")]
    [InlineData("satır bir\r\nsatır iki", "satır bir satır iki")]
    [InlineData("tab\there\u2028line\u2029para", "tab here line para")]
    [InlineData("Kadıköy, Moda \U0001F408", "Kadıköy, Moda \U0001F408")]
    public void ControlAndFormatCharactersAreRemovedAndBreaksBecomeSpaces(string input, string expected) =>
        Assert.Equal(expected, UserText.Clean(input));
}
