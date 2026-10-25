using Patika.Api.Features.Adoptions;
using Patika.Contracts.Adoptions;
using Xunit;

namespace Patika.Api.Tests.Adoptions;

public sealed class AdoptionValidationTests
{
    [Theory]
    [InlineData("", false)]
    [InlineData("\u0001\u0002", false)]
    [InlineData("Bir yuva arıyor", true)]
    public void DescriptionIsRequired(string description, bool valid) =>
        Assert.Equal(valid, new CreateAdoptionPostValidator().Validate(new CreateAdoptionPost(description, "Güvenli yuva", "Kadıköy")).IsValid);

    [Fact]
    public void OversizeMessageIsRejected() => Assert.False(new CreateAdoptionRequestValidator()
        .Validate(new CreateAdoptionRequest(new string('a', 3001))).IsValid);

    [Fact]
    public void InvalidStateIsRejected() => Assert.False(new UpdateAdoptionPostValidator()
        .Validate(new UpdateAdoptionPost(null, null, null, "Pending")).IsValid);

    [Fact]
    public void ControlsAreStripped() => Assert.Equal("abc", AdoptionText.Clean("a\u0000b\u202Ec\n"));
}
