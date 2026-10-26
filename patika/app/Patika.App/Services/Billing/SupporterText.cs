using System.Globalization;
using Patika.Contracts.Subscriptions;

namespace Patika.App.Services.Billing;

/// <summary>Turkish wording for the server entitlement; the server status names never reach the screen.</summary>
public static class SupporterText
{
    private static readonly CultureInfo Turkish = CultureInfo.GetCultureInfo("tr-TR");

    public static string Describe(EntitlementResponse entitlement)
    {
        if (entitlement.ExpiresAt is not { } expiresAt) return "Henüz Destekçi aboneliğin yok.";
        var date = expiresAt.ToLocalTime().ToString("d MMMM yyyy", Turkish);
        return entitlement.Status switch
        {
            "Active" => $"Destekçisin. Sonraki yenileme: {date}.",
            "InGracePeriod" => $"Ödeme alınamadı; Destekçi hakların {date} tarihine kadar sürer. Ödeme yöntemini Google Play'den güncelle.",
            "Canceled" => $"Abonelik iptal edildi. Destekçi hakların {date} tarihine kadar sürer.",
            "OnHold" => "Ödeme alınamadığı için abonelik askıda. Ödeme yöntemini Google Play'den güncelle.",
            "Paused" => "Abonelik duraklatıldı.",
            "Revoked" => "Bu satın alım geri alındı.",
            _ => $"Aboneliğin {date} tarihinde sona erdi.",
        };
    }

    /// <summary>Maps verification failures to text the person can act on.</summary>
    public static string Failure(string? code) => code switch
    {
        "purchase_owned_elsewhere" => "Bu satın alım başka bir Patika hesabına bağlı. O hesapla giriş yapıp geri yükleyebilirsin; hesap silindiyse aboneliği Google Play'den iptal et.",
        "purchase_not_found" => "Google Play bu satın alımı bulamadı. Satın alımları geri yüklemeyi dene.",
        "test_purchase_not_allowed" => "Test ödemeleri burada Destekçi hakkı vermez.",
        "purchase_superseded" => "Bu satın alımın yerini yenisi aldı. Satın alımları geri yüklemeyi dene.",
        "account_inactive" => "Hesabın şu an abonelik doğrulayamıyor.",
        _ => "Satın alım doğrulanamadı. Tekrar dene ya da satın alımları geri yükle.",
    };
}
