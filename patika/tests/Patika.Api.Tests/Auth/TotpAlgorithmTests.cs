using System.Text;
using Patika.Api.Features.Auth;
using Xunit;

namespace Patika.Api.Tests.Auth;

public sealed class TotpAlgorithmTests
{
    private static readonly byte[] Secret = Encoding.ASCII.GetBytes("12345678901234567890");

    [Theory]
    [InlineData(59, "94287082")]
    [InlineData(1111111109, "07081804")]
    [InlineData(1111111111, "14050471")]
    [InlineData(1234567890, "89005924")]
    [InlineData(2000000000, "69279037")]
    [InlineData(20000000000, "65353130")]
    public void Rfc6238Sha1Vectors(long seconds, string expected) =>
        Assert.Equal(expected, TotpAlgorithm.Code(Secret, seconds / 30, 8));

    [Theory]
    [InlineData(-2, false)]
    [InlineData(-1, true)]
    [InlineData(0, true)]
    [InlineData(1, true)]
    [InlineData(2, false)]
    public void OnlyAdjacentStepsAreAccepted(int offset, bool accepted)
    {
        var now = DateTimeOffset.FromUnixTimeSeconds(1234567890);
        var step = now.ToUnixTimeSeconds() / 30;
        var result = TotpAlgorithm.Match(Secret, TotpAlgorithm.Code(Secret, step + offset), now, -1);
        Assert.Equal(accepted, result.HasValue);
        if (accepted) Assert.Equal(step + offset, result);
    }

    [Fact]
    public void AcceptedAndOlderStepsCannotBeReplayed()
    {
        var now = DateTimeOffset.FromUnixTimeSeconds(1234567890);
        var step = now.ToUnixTimeSeconds() / 30;
        Assert.Null(TotpAlgorithm.Match(Secret, TotpAlgorithm.Code(Secret, step), now, step));
        Assert.Null(TotpAlgorithm.Match(Secret, TotpAlgorithm.Code(Secret, step - 1), now, step));
        Assert.Equal("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", TotpAlgorithm.Base32(Secret));
    }
}
