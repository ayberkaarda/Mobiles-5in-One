using Patika.Api.Features.CarePlaces;
using Xunit;

namespace Patika.Api.Tests.CarePlaces;

public sealed class CarePlaceCsvTests
{
    private const string Header = "name,kind,latitude,longitude,address,phone,open24h\n";

    [Fact]
    public void QuotedFieldsAndFlagsAreParsed()
    {
        var row = Assert.Single(CarePlaceCsv.Parse(Header + "\"Veteriner, merkez\",Vet,41,29,Adres,+90212,true\n"));
        Assert.Equal("Veteriner, merkez", row.Name);
        Assert.Equal("'+90212", row.Phone);
        Assert.True(row.Open24h);
        Assert.False(row.IsSample);
    }

    [Theory]
    [InlineData("=SUM(A1)")]
    [InlineData("+123")]
    [InlineData("-123")]
    [InlineData("@SUM(A1)")]
    [InlineData("\t=1")]
    public void FormulaCellsAreNeutralised(string text) => Assert.StartsWith("'", CarePlaceCsv.SafeCell(text));

    [Theory]
    [InlineData("A,Vet,90,29,Adres,,true")]
    [InlineData("A,1,41,29,Adres,,true")]
    [InlineData("A,Vet,41,29,Adres,,yes")]
    [InlineData("\"A,Vet,41,29,Adres,,true")]
    [InlineData("\"A\"x,Vet,41,29,Adres,,true")]
    [InlineData("A,Vet,41,29,Adres,,true,extra")]
    public void InvalidRowsAreRejected(string row) => Assert.Throws<FormatException>(() => CarePlaceCsv.Parse(Header + row));

    [Fact]
    public void UnknownColumnIsRejected() => Assert.Throws<FormatException>(() =>
        CarePlaceCsv.Parse(Header.Replace("name", "unknown") + "A,Vet,41,29,Adres,,true"));

    [Fact]
    public void RowCapIsEnforced() => Assert.Throws<FormatException>(() =>
        CarePlaceCsv.Parse(Header + string.Concat(Enumerable.Repeat("A,Vet,41,29,Adres,,true\n", 1001))));

    [Fact]
    public void ByteCapIsEnforced() => Assert.Throws<FormatException>(() => CarePlaceCsv.Parse(new string('a', CarePlaceCsv.MaxBytes + 1)));
}
