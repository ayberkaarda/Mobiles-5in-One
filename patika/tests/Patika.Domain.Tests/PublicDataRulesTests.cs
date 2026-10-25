using Microsoft.EntityFrameworkCore;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;
using Xunit;

namespace Patika.Domain.Tests;

public sealed class PublicDataRulesTests
{
    private static PatikaDbContext Context() => new(new DbContextOptionsBuilder<PatikaDbContext>()
        .UseNpgsql("Host=localhost;Port=1;Database=unused", pg => pg.UseNetTopologySuite()).Options);

    [Fact]
    public void ModerationDecisionsCannotBeEditedOrDeleted()
    {
        using var db = Context();
        var decision = new ModerationDecision { TargetType = "adoption", Reason = "Reviewed", DecidedAt = DateTimeOffset.UtcNow };
        db.Attach(decision);
        decision.Reason = "Changed";
        Assert.Contains("append-only", Assert.Throws<InvalidOperationException>(() => db.SaveChanges()).Message, StringComparison.Ordinal);
        db.Remove(decision);
        Assert.Contains("append-only", Assert.Throws<InvalidOperationException>(() => db.SaveChanges()).Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("http://example.org")]
    [InlineData("javascript:alert(1)")]
    [InlineData("invalid")]
    public void CarePlaceWebsiteRequiresHttps(string website)
    {
        using var db = Context();
        db.CarePlaces.Add(new CarePlace { Name = "Clinic", Address = "Street", Website = website });
        Assert.Contains("HTTPS", Assert.Throws<InvalidOperationException>(() => db.SaveChanges()).Message, StringComparison.Ordinal);
    }

    [Fact]
    public void BirthYearMustBePlausible()
    {
        using var db = Context();
        var animal = new Animal { BirthYear = 1989 };
        db.Animals.Add(animal);
        Assert.Contains("Birth year", Assert.Throws<InvalidOperationException>(() => db.SaveChanges()).Message, StringComparison.Ordinal);
        animal.BirthYear = (short)(DateTimeOffset.UtcNow.ToOffset(TimeSpan.FromHours(3)).Year + 1);
        Assert.Contains("Birth year", Assert.Throws<InvalidOperationException>(() => db.SaveChanges()).Message, StringComparison.Ordinal);
    }
}
