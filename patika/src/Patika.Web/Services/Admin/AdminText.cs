using System.Globalization;

namespace Patika.Web.Services.Admin;

public static class AdminText
{
    public static string Role(string value) => value switch
    {
        "Admin" => "Yönetici",
        "Moderator" => "Moderatör",
        "Trusted" => "Güvenilir",
        "User" => "Kullanıcı",
        _ => value
    };

    public static string State(string value) => value switch
    {
        "Pending" => "Bekliyor",
        "Published" => "Yayında",
        "Approved" => "Onaylandı",
        "Rejected" => "Reddedildi",
        "Open" => "Açık",
        "Handled" => "İlgilenildi",
        "Closed" => "Kapandı",
        "Reviewed" => "İncelendi",
        "Dismissed" => "Kapatıldı",
        _ => value
    };

    public static string Coordinates(double? latitude, double? longitude) =>
        latitude is null || longitude is null ? "" : string.Create(CultureInfo.InvariantCulture, $"{latitude:0.0000}, {longitude:0.0000}");

    public static string Short(Guid? id) => id is null ? "-" : "…" + id.Value.ToString("N", CultureInfo.InvariantCulture)[^12..];

    public static string CsvError(string code) => code switch
    {
        "column_count" => "Sütun sayısı başlıkla eşleşmiyor.",
        "phone_invalid" => "Telefon numarası geçersiz.",
        "district_invalid" => "İlçe bulunamadı.",
        "fields_invalid" => "Ad, tür, konum, adres veya çalışma saati alanı geçersiz.",
        _ when code.StartsWith("formula_cell:", StringComparison.Ordinal) => "Formül içeren hücre kabul edilmez: " + code[13..],
        _ => "Satır doğrulanamadı."
    };
}
