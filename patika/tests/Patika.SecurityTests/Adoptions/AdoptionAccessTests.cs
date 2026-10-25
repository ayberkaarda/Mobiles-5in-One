using System.Text.Json;
using Patika.Api.Features.Adoptions;
using Patika.Domain.Entities;
using Patika.Domain.Security;
using Xunit;

namespace Patika.SecurityTests.Adoptions;

public sealed class AdoptionAccessTests
{
    [Fact]
    public void UnrelatedUserCannotManagePostOrReadRequests()
    {
        var post = Post();
        var actor = new Actor(Guid.NewGuid(), ActorRole.User);
        var request = new AdoptionRequest { PostId = post.Id, RequesterId = Guid.NewGuid(), Message = "Mesaj" };
        Assert.False(AdoptionEndpoints.CanManage(actor, post));
        Assert.False(AdoptionEndpoints.CanReadRequest(actor, post, request));
    }

    [Fact]
    public void RequesterCanOnlyReadTheirOwnRequest()
    {
        var post = Post();
        var actor = new Actor(Guid.NewGuid(), ActorRole.User);
        var request = new AdoptionRequest { PostId = post.Id, RequesterId = actor.UserId!.Value, Message = "Mesaj" };
        Assert.True(AdoptionEndpoints.CanReadRequest(actor, post, request));
        Assert.False(AdoptionEndpoints.CanManage(actor, post));
        request.PostId = Guid.NewGuid();
        Assert.False(AdoptionEndpoints.CanReadRequest(actor, post, request));
    }

    [Fact]
    public void DescriptionRemainsPlainJsonText()
    {
        const string payload = "<script>alert(1)</script>";
        var post = Post();
        post.Description = AdoptionText.Clean(payload);
        var json = JsonSerializer.Serialize(post);
        Assert.DoesNotContain("<script>", json);
        Assert.Equal(payload, JsonSerializer.Deserialize<AdoptionPost>(json)!.Description);
    }

    private static AdoptionPost Post() => new()
    {
        AnimalId = Guid.NewGuid(),
        CreatedBy = Guid.NewGuid(),
        Description = "Yuva arıyor",
        Requirements = "Güvenli yuva",
        District = "Kadıköy"
    };
}
