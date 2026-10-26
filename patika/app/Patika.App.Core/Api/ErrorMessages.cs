namespace Patika.App.Core.Api;

/// <summary>Problem details <c>code</c> values the app reacts to. Mirrors the API; unknown codes fall back by status.</summary>
public static class ErrorCodes
{
    public const string ValidationFailed = "validation_failed";
    public const string InvalidCredentials = "invalid_credentials";
    public const string PasswordBreached = "password_breached";
    public const string VerificationInvalid = "verification_invalid";
    public const string ExternalTokenInvalid = "external_token_invalid";
    public const string LinkRequired = "link_required";
    public const string ExternalLoginInUse = "external_login_in_use";
    public const string ReauthenticationRequired = "reauthentication_required";
    public const string RefreshInvalid = "refresh_invalid";
    public const string RefreshReused = "refresh_reused";
    public const string RateLimited = "rate_limited";
    public const string EmailUnavailable = "email_unavailable";
    public const string ResetInvalid = "reset_invalid";
    public const string FeedingCooldown = "feeding_cooldown";
    public const string UrgentDailyCap = "urgent_daily_cap";
    public const string UrgentNotFound = "urgent_not_found";
    public const string UrgentInvalidTransition = "urgent_invalid_transition";
    public const string UrgentPhotoNotFound = "urgent_photo_not_found";
    public const string UploadQuotaExceeded = "upload_quota_exceeded";
    public const string StorageUnavailable = "storage_unavailable";
    public const string DeviceLimit = "device_limit";
    public const string DeviceTokenInUse = "device_token_in_use";
    public const string IdempotencyMismatch = "idempotency_mismatch";
    public const string IdempotencyKeyInvalid = "idempotency_key_invalid";
    public const string IdempotencyInProgress = "idempotency_in_progress";

    /// <summary>Client-side: there is no session to send the request with.</summary>
    public const string SignInRequired = "sign_in_required";

    /// <summary>Client-side: a bound request was stopped because the signed-in account or session changed.</summary>
    public const string SessionChanged = "session_changed";

    /// <summary>Client-side: an outbox record that can no longer be read (bad id or payload).</summary>
    public const string OutboxMalformed = "outbox_malformed";

    /// <summary>Client-side: an outbox record that kept failing until its attempts or age ran out.</summary>
    public const string OutboxExhausted = "outbox_exhausted";
}

/// <summary>Turkish, user-facing text for each failure. Server titles are never shown as they are.</summary>
public static class ErrorMessages
{
    public const string Network = "Bağlantı kurulamadı. İnternetin gelince yeniden dene.";
    public const string SignInRequired = "Oturumun sona erdi. Lütfen yeniden giriş yap.";
    public const string Server = "Sunucuda bir sorun oldu. Biraz sonra yeniden dene.";
    public const string Unknown = "Bir şeyler ters gitti. Yeniden dene.";

    private static readonly Dictionary<string, string> ByCode = new(StringComparer.Ordinal)
    {
        [ErrorCodes.ValidationFailed] = "Bazı alanlar eksik ya da hatalı. Kontrol edip yeniden dene.",
        [ErrorCodes.InvalidCredentials] = "E-posta ya da şifre hatalı.",
        [ErrorCodes.PasswordBreached] = "Bu şifre sızdırılmış şifre listelerinde var. Başka bir şifre seç.",
        [ErrorCodes.VerificationInvalid] = "Kod hatalı ya da süresi dolmuş. Yeni kod iste.",
        [ErrorCodes.ExternalTokenInvalid] = "Google ile giriş doğrulanamadı. Yeniden dene.",
        [ErrorCodes.LinkRequired] = "Bu e-postayla bir hesap var. Önce şifrenle giriş yapıp Google'ı bağla.",
        [ErrorCodes.ExternalLoginInUse] = "Bu Google hesabı başka bir Patika hesabına bağlı.",
        [ErrorCodes.ReauthenticationRequired] = "Güvenliğin için yeniden giriş yapman gerekiyor.",
        [ErrorCodes.RefreshInvalid] = SignInRequired,
        [ErrorCodes.RefreshReused] = SignInRequired,
        [ErrorCodes.RateLimited] = "Çok fazla deneme yapıldı. Biraz bekleyip yeniden dene.",
        [ErrorCodes.EmailUnavailable] = "Şu an e-posta gönderemiyoruz. Biraz sonra yeniden dene.",
        [ErrorCodes.ResetInvalid] = "Şifre sıfırlama bağlantısı geçersiz ya da süresi dolmuş.",
        [ErrorCodes.FeedingCooldown] = "Bu istasyonu yakın zamanda besledin. 30 dakika sonra yeniden kaydedebilirsin.",
        [ErrorCodes.UrgentDailyCap] = "Bugün en fazla 3 acil çağrı açabilirsin.",
        [ErrorCodes.UrgentNotFound] = "Bu acil çağrı artık yok.",
        [ErrorCodes.UrgentInvalidTransition] = "Bu acil çağrının durumu değiştirilemez.",
        [ErrorCodes.UrgentPhotoNotFound] = "Fotoğraf bulunamadı. Yeniden yükle.",
        [ErrorCodes.UploadQuotaExceeded] = "Bugünlük fotoğraf yükleme hakkın doldu.",
        [ErrorCodes.StorageUnavailable] = "Fotoğraf şu an yüklenemiyor. Biraz sonra yeniden dene.",
        [ErrorCodes.DeviceLimit] = "Bildirim için kayıtlı cihaz sınırına ulaştın.",
        [ErrorCodes.DeviceTokenInUse] = "Bu cihaz başka bir hesapla kayıtlı.",
        [ErrorCodes.IdempotencyMismatch] = "Bu kayıt daha önce farklı bilgilerle gönderilmiş.",
        [ErrorCodes.IdempotencyKeyInvalid] = Unknown,
        [ErrorCodes.IdempotencyInProgress] = "Kayıt hâlâ gönderiliyor. Birazdan yeniden denenecek.",
        [ErrorCodes.SignInRequired] = SignInRequired,
        [ErrorCodes.SessionChanged] = SignInRequired,
        [ErrorCodes.OutboxMalformed] = "Bu kayıt okunamadı ve gönderilemedi.",
        [ErrorCodes.OutboxExhausted] = "Bu kayıt uzun süre gönderilemedi; artık denenmeyecek.",
    };

    /// <summary>Text for a problem <paramref name="code"/>; unknown codes fall back to the HTTP status.</summary>
    public static string For(string? code, int? status)
    {
        if (code is not null && ByCode.TryGetValue(code, out var text))
        {
            return text;
        }

        return status switch
        {
            400 => ByCode[ErrorCodes.ValidationFailed],
            401 => SignInRequired,
            403 => "Bunu yapmaya yetkin yok.",
            404 => "Aradığın kayıt bulunamadı.",
            409 => "Bu işlem şu an yapılamıyor; kayıt değişmiş olabilir.",
            413 => "Dosya çok büyük.",
            429 => ByCode[ErrorCodes.RateLimited],
            >= 500 => Server,
            _ => Unknown,
        };
    }
}
