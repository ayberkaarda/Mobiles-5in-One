using System.Globalization;
using System.Text;
using Patika.Api.Features.Adoptions;
using Patika.Api.Validation;
using Patika.Domain;
using Patika.Domain.Entities;

namespace Patika.Api.Features.CarePlaces;

public static class CarePlaceCsv
{
    public const int MaxBytes = 1_048_576;
    public const int MaxRows = 1000;
    private static readonly string[] OptionalColumns = ["district", "website"];
    private static readonly string[] Columns = ["name", "kind", "latitude", "longitude", "address", "phone", "open24h"];

    public static string SafeCell(string value)
    {
        var clean = AdoptionText.Clean(value);
        return clean.Length > 0 && "=+-@".Contains(clean[0]) ? "'" + clean : clean;
    }

    public static IReadOnlyList<CarePlace> Parse(string csv)
    {
        if (Encoding.UTF8.GetByteCount(csv) > MaxBytes) throw new FormatException("CSV boyutu aşıldı.");
        var records = ReadRecords(csv.TrimStart('\uFEFF'));
        if (records.Count < 2 || records.Count > MaxRows + 1) throw new FormatException("Satır sayısı geçersiz.");
        var header = records[0];
        if (header.Length < Columns.Length || header.Length > Columns.Length + OptionalColumns.Length || header.Distinct(StringComparer.Ordinal).Count() != header.Length
            || Columns.Any(c => !header.Contains(c, StringComparer.Ordinal)) || header.Any(c => !Columns.Contains(c, StringComparer.Ordinal) && !OptionalColumns.Contains(c, StringComparer.Ordinal))) throw new FormatException("CSV sütunları geçersiz.");
        var result = new List<CarePlace>();
        foreach (var row in records.Skip(1))
        {
            if (row.Length != header.Length) throw new FormatException("CSV satırı geçersiz.");
            string Cell(string column) => Array.IndexOf(header, column) is var index && index >= 0 ? row[index] : "";
            if (!double.TryParse(Cell("latitude"), NumberStyles.Float, CultureInfo.InvariantCulture, out var lat)
                || !double.TryParse(Cell("longitude"), NumberStyles.Float, CultureInfo.InvariantCulture, out var lon)
                || !GeoRules.IsInsideTurkey(lat, lon)
                || !Enum.TryParse<CarePlaceKind>(Cell("kind"), out var kind) || !Enum.IsDefined(kind)
                || Cell("kind") != kind.ToString()
                || !bool.TryParse(Cell("open24h"), out var open)) throw new FormatException("CSV alanı geçersiz.");
            var name = SafeCell(Cell("name"));
            var address = SafeCell(Cell("address"));
            var phone = SafeCell(Cell("phone"));
            var website = Cell("website").Trim();
            var district = SafeCell(Cell("district"));
            if (district.Length > 100 || (website.Length > 0 && (website.Length > 2048
                || !Uri.TryCreate(website, UriKind.Absolute, out var websiteUri) || websiteUri.Scheme != Uri.UriSchemeHttps)))
                throw new FormatException("CSV metni geçersiz.");
            if (string.IsNullOrWhiteSpace(name) || name.Length > 200 || string.IsNullOrWhiteSpace(address)
                || address.Length > 1000 || phone.Length > 50) throw new FormatException("CSV metni geçersiz.");
            result.Add(new CarePlace
            {
                Name = name,
                District = district.Length == 0 ? null : district,
                Website = website.Length == 0 ? null : website,
                Address = address,
                Phone = phone.Length == 0 ? null : phone,
                Kind = kind,
                Location = new GeoPoint(lon, lat),
                Open24h = open,
                Verified = false,
                IsSample = false
            });
        }
        return result;
    }

    private static List<string[]> ReadRecords(string csv)
    {
        var records = new List<string[]>();
        var row = new List<string>();
        var cell = new StringBuilder();
        var quoted = false;
        var endedQuote = false;
        for (var i = 0; i < csv.Length; i++)
        {
            var c = csv[i];
            if (quoted)
            {
                if (c == '"')
                {
                    if (i + 1 < csv.Length && csv[i + 1] == '"') { cell.Append('"'); i++; }
                    else { quoted = false; endedQuote = true; }
                }
                else cell.Append(c);
                continue;
            }
            if (c == '"')
            {
                if (cell.Length != 0 || endedQuote) throw new FormatException("CSV tırnakları geçersiz.");
                quoted = true;
            }
            else if (c is ',' or '\n' or '\r')
            {
                row.Add(cell.ToString()); cell.Clear(); endedQuote = false;
                if (c != ',')
                {
                    if (c == '\r' && i + 1 < csv.Length && csv[i + 1] == '\n') i++;
                    records.Add(row.ToArray()); row.Clear();
                    if (records.Count > MaxRows + 1) throw new FormatException("Satır sınırı aşıldı.");
                }
            }
            else
            {
                if (endedQuote) throw new FormatException("CSV tırnak sonu geçersiz.");
                cell.Append(c);
            }
        }
        if (quoted) throw new FormatException("CSV tırnakları kapanmadı.");
        if (cell.Length > 0 || row.Count > 0 || endedQuote) { row.Add(cell.ToString()); records.Add(row.ToArray()); }
        return records;
    }
}
