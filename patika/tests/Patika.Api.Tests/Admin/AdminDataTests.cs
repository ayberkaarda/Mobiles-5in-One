using System.Text;
using Microsoft.EntityFrameworkCore;
using Patika.Api.Features.Admin;
using Patika.Api.Features.CarePlaces;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;
using Xunit;

namespace Patika.Api.Tests.Admin;

public sealed class AdminDataTests
{
    private const string Header = "name,kind,latitude,longitude,address,phone,open24h,district,website\n";

    [Fact]
    public async Task PreviewReportsEachRowAndFlagsFormulas()
    {
        var preview = await CarePlaceCsv.PreviewAsync(Encoding.UTF8.GetBytes(Header +
            "Merkez,Vet,41,29,Adres,02121234567,true,Kadikoy,https://example.org\n" +
            "=SUM(A1),Vet,41,29,Adres,,true,Unknown,https://example.org\n" +
            "Bad,Vet,90,29,Adres,,true,,http://example.org\n"), new Districts(), TestContext.Current.CancellationToken);
        Assert.Equal(3, preview.Rows.Count);
        Assert.Equal("valid", preview.Rows[0].Status);
        Assert.Equal(2, preview.Rows[0].Row);
        Assert.Contains("formula_cell:name", preview.Rows[1].Errors);
        Assert.Contains("district_invalid", preview.Rows[1].Errors);
        Assert.Equal("error", preview.Rows[2].Status);
        Assert.Equal(64, preview.PreviewHash.Length);
    }

    [Fact]
    public async Task InternationalPhoneNumbersAreNotFormulaCells()
    {
        var preview = await CarePlaceCsv.PreviewAsync(Encoding.UTF8.GetBytes(Header +
            "Merkez,Vet,41,29,Adres,+90 212 123 45 67,true,,\n" +
            "Merkez,Vet,41,29,Adres,+cmd|calc,true,,\n"), new Districts(), TestContext.Current.CancellationToken);
        Assert.Equal("valid", preview.Rows[0].Status);
        Assert.Equal("+90 212 123 45 67", preview.Rows[0].Fields!.Phone);
        Assert.Contains("formula_cell:phone", preview.Rows[1].Errors);
        Assert.Contains("phone_invalid", preview.Rows[1].Errors);
    }

    [Fact]
    public async Task PreviewSupportsTwoThousandRowsAndRejectsMore()
    {
        var csv = Header + string.Concat(Enumerable.Repeat("A,Vet,41,29,Adres,,true,,\n", 2000));
        Assert.Equal(2000, (await CarePlaceCsv.PreviewAsync(Encoding.UTF8.GetBytes(csv), new Districts(), TestContext.Current.CancellationToken)).Rows.Count);
        await Assert.ThrowsAsync<FormatException>(() => CarePlaceCsv.PreviewAsync(Encoding.UTF8.GetBytes(csv + "A,Vet,41,29,Adres,,true,,\n"), new Districts(), TestContext.Current.CancellationToken));
    }

    [Theory]
    [InlineData("ayber@gmail.com", "a***@g***.com")]
    [InlineData(null, null)]
    public void EmailIsMasked(string? input, string? expected) => Assert.Equal(expected, AdminPrivacy.MaskEmail(input));

    [Fact]
    public async Task AuditSaveGuardRejectsChangesAndDeletesBeforeDatabaseAccess()
    {
        await using var db = new PatikaDbContext(new DbContextOptionsBuilder<PatikaDbContext>()
            .UseNpgsql("Host=127.0.0.1;Port=1;Database=none", p => p.UseNetTopologySuite()).Options);
        var entry = new AuditLog { Action = "review", TargetType = "adoption" };
        db.Attach(entry);
        entry.Action = "changed";
        Assert.Throws<InvalidOperationException>(() => db.SaveChanges());
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync(TestContext.Current.CancellationToken));
        db.Remove(entry);
        Assert.Throws<InvalidOperationException>(() => db.SaveChanges());
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync(TestContext.Current.CancellationToken));
    }

    private sealed class Districts : IDistrictResolver
    {
        public Task<Guid?> ResolveAsync(string? text, CancellationToken ct = default) =>
            Task.FromResult<Guid?>(text == "Kadikoy" ? Guid.NewGuid() : null);
    }
}
