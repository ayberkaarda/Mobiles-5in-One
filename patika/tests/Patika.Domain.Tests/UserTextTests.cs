using Xunit;

namespace Patika.Domain.Tests;

public sealed class UserTextTests
{
    [Theory]
    [InlineData("Yaralı\u202E kedi", "Yaralı kedi")]
    [InlineData("a\u0001b\u007fc\u0085d", "abcd")]
    [InlineData("zero\u200Bwidth\u2066iso\u2069", "zerowidthiso")]
    [InlineData("satır bir\r\nsatır iki", "satır bir satır iki")]
    [InlineData("tab\there\u2028line\u2029para", "tab here line para")]
    [InlineData("Kadıköy, Moda \U0001F408", "Kadıköy, Moda \U0001F408")]
    [InlineData("\uFEFFbom", "bom")]
    public void ControlAndFormatCharactersAreRemovedAndBreaksBecomeSpaces(string input, string expected) =>
        Assert.Equal(expected, UserText.Clean(input));

    [Theory]
    // U+E0001 LANGUAGE TAG and the tag letters U+E0041..: supplementary format characters, two UTF-16 units each.
    [InlineData("gizli\U000E0001\U000E0041\U000E0042yazı", "gizliyazı")]
    [InlineData("\U000E0020\U000E007F", "")]
    // U+1D173 MUSICAL SYMBOL BEGIN BEAM is a supplementary format character too.
    [InlineData("nota\U0001D173", "nota")]
    public void SupplementaryFormatCharactersAreRemovedWhole(string input, string expected) =>
        Assert.Equal(expected, UserText.Clean(input));

    [Theory]
    // Family emoji: man ZWJ woman ZWJ girl.
    [InlineData("Aile \U0001F468\u200D\U0001F469\u200D\U0001F467", "Aile \U0001F468\u200D\U0001F469\u200D\U0001F467")]
    // Persian "I want" keeps its ZERO WIDTH NON-JOINER.
    [InlineData("می\u200Cخواهم", "می\u200Cخواهم")]
    public void JoinersBetweenVisibleCharactersStay(string input, string expected) =>
        Assert.Equal(expected, UserText.Clean(input));

    [Theory]
    [InlineData("\u200D\u200D\u200C", "")]
    [InlineData("\u200Dkedi\u200D", "kedi")]
    [InlineData("a\u200D\u200D\u200Db", "a\u200Db")]
    [InlineData("a\u200D b", "a b")]
    [InlineData("a \u200Db", "a b")]
    public void JoinersCannotHideAtTheEdgesOrPileUp(string input, string expected) =>
        Assert.Equal(expected, UserText.Clean(input));

    [Fact]
    public void MalformedSurrogatesBecomeTheReplacementCharacter()
    {
        // Built in code: attribute data is stored as UTF-8 and cannot carry a lone surrogate.
        Assert.Equal("ab�cd", UserText.Clean("ab" + (char)0xD800 + "cd"));
        Assert.Equal("�x", UserText.Clean((char)0xDC00 + "x"));
        Assert.Equal("x�", UserText.Clean("x" + (char)0xD83D));
        Assert.Equal("��", UserText.Clean(new string([(char)0xDC00, (char)0xD800])));
    }

    [Fact]
    public void CleaningTwiceChangesNothing()
    {
        var messy = "\u200Da\u202E\tb\U000E0001\u200D\U0001F469\r\n" + (char)0xD800;
        var once = UserText.Clean(messy);
        Assert.Equal(once, UserText.Clean(once));
    }
}
