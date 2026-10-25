using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Patika.Api.Features.Adoptions;
using Patika.Api.Validation;
using Patika.Contracts.Admin;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;

namespace Patika.Api.Features.CarePlaces;

public static class CarePlaceCsv
{
    public const int MaxBytes = 1_048_576;
    public const int MaxRows = 1000;
    private static readonly string[] OptionalColumns = ["district", "website"];
    private static readonly string[] Columns = ["name", "kind", "latitude", "longitude", "address", "phone", "open24h"];

    /// <summary>A plain phone number; it may start with <c>+</c> but cannot carry a spreadsheet formula.</summary>
    public static bool IsPhone(string value) => Regex.IsMatch(value, @"^\+?[0-9][0-9 ()-]{5,24}[0-9]$",
        RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100));

    public static string SafeCell(string value)
    {
        var clean = AdoptionText.Clean(value);
        return clean.Length > 0 && "=+-@".Contains(clean[0]) ? "'" + clean : clean;
    }

    public static IReadOnlyList<CarePlace> Parse(string csv, int maxRows = MaxRows)
    {
        if (Encoding.UTF8.GetByteCount(csv) > MaxBytes) throw new FormatException("CSV boyutu aşıldı.");
        var records = ReadRecords(csv.TrimStart('\uFEFF'), maxRows);
        if (records.Count < 2 || records.Count > maxRows + 1) throw new FormatException("Satır sayısı geçersiz.");
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
            var phone = IsPhone(Cell("phone").Trim()) ? Cell("phone").Trim() : SafeCell(Cell("phone"));
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

    public static async Task<CarePlacePreview> PreviewAsync(byte[] bytes, IDistrictResolver districts, CancellationToken ct)
    {
        if (bytes.Length > MaxBytes) throw new FormatException("CSV size exceeded.");
        var csv = new UTF8Encoding(false, true).GetString(bytes).TrimStart('\uFEFF');
        var records = ReadRecords(csv, 2000);
        if (records.Count < 2) throw new FormatException("CSV rows required.");
        var header = records[0];
        if (header.Length < Columns.Length || header.Length > Columns.Length + OptionalColumns.Length
            || header.Distinct(StringComparer.Ordinal).Count() != header.Length
            || Columns.Any(c => !header.Contains(c, StringComparer.Ordinal))
            || header.Any(c => !Columns.Contains(c, StringComparer.Ordinal) && !OptionalColumns.Contains(c, StringComparer.Ordinal)))
            throw new FormatException("CSV columns invalid.");
        static string Line(string[] cells) => string.Join(',', cells.Select(c => "\"" + c.Replace("\"", "\"\"", StringComparison.Ordinal) + "\""));
        var rows = new List<CarePlaceCsvRow>();
        for (var i = 1; i < records.Count; i++)
        {
            var row = records[i];
            var errors = new List<string>();
            CarePlaceCsvFields? fields = null;
            if (row.Length != header.Length) errors.Add("column_count");
            var phoneColumn = Array.IndexOf(header, "phone");
            for (var column = 0; column < row.Length; column++)
            {
                var clean = AdoptionText.Clean(row[column]);
                if (column == phoneColumn && IsPhone(row[column].Trim())) continue;
                if (clean.Length > 0 && "=+-@".Contains(clean[0])) errors.Add($"formula_cell:{(column < header.Length ? header[column] : column.ToString(CultureInfo.InvariantCulture))}");
            }
            try
            {
                var place = Parse(Line(header) + "\n" + Line(row)).Single();
                var phone = phoneColumn < row.Length ? row[phoneColumn].Trim() : "";
                if (phone.Length > 0 && !IsPhone(phone)) errors.Add("phone_invalid");
                if (place.District is not null && await districts.ResolveAsync(place.District, ct) is null) errors.Add("district_invalid");
                fields = new CarePlaceCsvFields(place.Name, place.Kind.ToString(), place.Location.Latitude, place.Location.Longitude,
                    place.Address, place.Phone, place.Open24h, place.District, place.Website);
            }
            catch (FormatException) { errors.Add("fields_invalid"); }
            rows.Add(new CarePlaceCsvRow(i + 1, errors.Count == 0 ? "valid" : "error", errors, fields));
        }
        return new CarePlacePreview(Convert.ToHexString(SHA256.HashData(bytes)), rows);
    }

    private static List<string[]> ReadRecords(string csv, int maxRows = MaxRows)
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
                    if (records.Count > maxRows + 1) throw new FormatException("Satır sınırı aşıldı.");
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
        if (records.Count > maxRows + 1) throw new FormatException("CSV row limit exceeded.");
        return records;
    }
}
