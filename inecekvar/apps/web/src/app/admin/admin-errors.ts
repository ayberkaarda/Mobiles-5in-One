import { isApiError } from '@inecekvar/data-access';

/** Where a failure happened; a 403 reads differently on the approve button. */
export type ErrorContext = 'generic' | 'approve' | 'reject' | 'role' | 'sign-in' | 'totp';

/** Thrown by the step-up flow when the person closes the code dialog. */
export class StepUpCancelled extends Error {
  override readonly name = 'StepUpCancelled';
  constructor() {
    super('step-up cancelled');
  }
}

/** Thrown when the signed-in account changed (another tab) before a step-up retry ran. */
export class AccountChanged extends Error {
  override readonly name = 'AccountChanged';
  constructor() {
    super('account changed');
  }
}

const MESSAGES: Readonly<Record<string, string>> = {
  'auth.required': 'Oturumun sona erdi. Devam etmek için yeniden giriş yap.',
  'auth.token_invalid': 'Oturumun sona erdi. Devam etmek için yeniden giriş yap.',
  'auth.invalid_credentials': 'E-posta ya da şifre yanlış.',
  'auth.forbidden':
    'Bu işlem için yetkin yok. Karar sunucuda verilir; rolün bu işleme izin vermiyor.',
  'auth.step_up_required': 'Bu işlem için doğrulama kodu gerekiyor.',
  'auth.totp_enrolment_required':
    'Bu işlem için önce iki adımlı doğrulamayı (TOTP) kurmalısın. "Doğrulama" sayfasına git.',
  'auth.totp_invalid_code': 'Kod geçersiz ya da daha önce kullanıldı. Uygulamadaki yeni kodu gir.',
  'auth.totp_already_enabled': 'İki adımlı doğrulama bu hesapta zaten açık.',
  'auth.totp_not_pending': 'Bekleyen bir kurulum yok. Kurulumu yeniden başlat.',
  'auth.totp_unavailable': 'Doğrulama hizmeti şu anda kullanılamıyor. Biraz sonra yeniden dene.',
  'auth.reauth_required':
    'Güvenlik için son 10 dakika içinde giriş yapmış olman gerekiyor. Çıkış yapıp yeniden gir.',
  'csrf.invalid': 'Güvenlik belirteci yenilenemedi. Sayfayı yenileyip yeniden dene.',
  'origin.not_allowed': 'Bu adresten giriş yapılamıyor.',
  'admin.last_admin':
    'Son yönetici rolünü bırakamaz. Önce başka bir hesabı yönetici yap, sonra yeniden dene.',
  'user.not_found': 'Kullanıcı bulunamadı.',
  'user.deactivated': 'Bu hesap kapatılmış; rolü değiştirilemez.',
  'edit.not_found': 'Öneri bulunamadı; başka bir moderatör karar vermiş olabilir.',
  'edit.version_conflict':
    'Hat bu öneriden sonra değişti. Öneri eski sürüme göre yazılmış; reddedip yeni öneri istenmeli.',
  'edit.invalid_payload': 'Öneri artık geçerli değil.',
  'edit.invalid_stops': 'Önerideki duraklardan biri artık etkin değil.',
  'edit.outside_bbox': 'Önerilen güzergâh şehir sınırının dışına çıkıyor.',
  'moderation.reciprocal_conflict':
    'Bu kişiyle karşılıklı onay geçmişin var. Bağımsız üçüncü bir moderatör karar vermeli.',
  'line.not_found': 'Hat bulunamadı.',
  'line.version_not_found': 'Bu sürüm bulunamadı.',
  'city.not_found': 'Şehir bulunamadı.',
  'export.in_progress': 'Bu şehir için bir dışa aktarım sürüyor. Bitince yeniden dene.',
  'export.too_large': 'Dışa aktarım boyut sınırını aşıyor; hiçbir şey yüklenmedi.',
  'validation.failed': 'Girilen değerlerden biri geçersiz.',
  conflict: 'İşlem başka bir değişiklikle çakıştı. Listeyi yenileyip yeniden dene.',
  network: 'Sunucuya ulaşılamıyor. Bağlantını kontrol edip yeniden dene.',
  timeout: 'Sunucu zamanında yanıt vermedi. Yeniden dene.',
  aborted: 'İstek iptal edildi.',
  invalid_response: 'Sunucudan beklenmeyen bir yanıt geldi.',
};

const CONTEXT_FORBIDDEN: Partial<Record<ErrorContext, string>> = {
  approve:
    'Bu öneriyi onaylayamazsın: kendi önerini onaylayamazsın ya da rolün yetmiyor. Başka bir moderatör karar vermeli.',
  reject: 'Bu öneriyi reddedemezsin: kendi önerine karar veremezsin ya da rolün yetmiyor.',
  role: 'Rolleri yalnızca yöneticiler değiştirebilir.',
};

/**
 * Turkish copy for a failure. The text comes from the problem `code` only; problem bodies,
 * request ids and user input are never shown or logged.
 */
export function adminErrorMessage(error: unknown, context: ErrorContext = 'generic'): string {
  if (error instanceof StepUpCancelled) return 'Doğrulama iptal edildi; işlem yapılmadı.';
  if (error instanceof AccountChanged) {
    return 'Oturumdaki hesap başka bir sekmede değişti; işlem yapılmadı. Hesabı kontrol edip yeniden dene.';
  }
  if (!isApiError(error)) return 'Beklenmeyen bir hata oluştu. Sayfayı yenileyip yeniden dene.';
  if (error.status === 429 || error.code === 'rate_limited') {
    const wait = error.retryAfterSeconds;
    const minutes = wait === null ? null : Math.max(1, Math.ceil(wait / 60));
    return minutes === null
      ? 'Çok fazla deneme yapıldı. Biraz bekleyip yeniden dene.'
      : `Çok fazla deneme yapıldı. Yaklaşık ${minutes} dakika sonra yeniden dene.`;
  }
  if (context === 'sign-in' && error.status === 401)
    return MESSAGES['auth.invalid_credentials'] as string;
  if (error.status === 401) return MESSAGES['auth.required'] as string;
  if (error.status === 403 && error.code === 'auth.forbidden') {
    return CONTEXT_FORBIDDEN[context] ?? (MESSAGES['auth.forbidden'] as string);
  }
  const known = MESSAGES[error.code];
  if (known) return known;
  if (error.status === 403) return MESSAGES['auth.forbidden'] as string;
  if (error.status === 404) return 'Aranan kayıt bulunamadı.';
  if (error.status === 409) return MESSAGES['conflict'] as string;
  if (error.status === 422) return MESSAGES['validation.failed'] as string;
  if (error.status >= 500) return 'Sunucuda bir sorun oluştu. Biraz sonra yeniden dene.';
  return 'İşlem tamamlanamadı. Yeniden dene.';
}

/** True when the error means the server no longer knows this session. */
export function isSessionEnded(error: unknown): boolean {
  return isApiError(error) && error.status === 401;
}

export function hasCode(error: unknown, code: string): boolean {
  return isApiError(error) && error.code === code;
}
