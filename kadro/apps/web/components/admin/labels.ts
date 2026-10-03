import { type PlatformRole, type VenueImportStatus } from '@kadro/contracts';

/** Turkish labels of the staff panel (ADR-0068). Unknown values fall back to the raw code. */

const ROLE_LABELS: ReadonlyMap<PlatformRole, string> = new Map([
  ['user', 'Oyuncu'],
  ['moderator', 'Moderatör'],
  ['admin', 'Yönetici'],
]);

export function roleLabel(role: PlatformRole): string {
  return ROLE_LABELS.get(role) ?? role;
}

export const IMPORT_STATUS_LABELS: Readonly<Record<VenueImportStatus, string>> = {
  queued: 'Sırada',
  processing: 'İşleniyor',
  completed: 'Tamamlandı',
  failed: 'Başarısız',
};

const ISSUE_LABELS: ReadonlyMap<string, string> = new Map([
  ['too_many_rows', 'Dosyada 5 000 satırdan fazla veri var.'],
  ['invalid_quote', 'CSV okunamadı: tırnak hatası.'],
  ['unterminated_quote', 'CSV okunamadı: kapanmayan tırnak.'],
  ['missing_header', 'Başlık satırı yok.'],
  ['missing_column', 'Zorunlu bir sütun eksik.'],
  ['unknown_column', 'Tanınmayan bir sütun var.'],
  ['duplicate_column', 'Aynı sütun birden fazla kez var.'],
  ['column_count', 'Satırdaki değer sayısı başlıkla uyuşmuyor.'],
  ['required', 'Bu alan zorunlu.'],
  ['reserved', '[ÖRNEK] ön eki yalnızca örnek sahalar içindir.'],
  ['formula_like', 'Değer formül gibi başlıyor (=, +, -, @).'],
  ['invalid_number', 'Sayı bekleniyor.'],
  ['invalid_integer', 'Tam sayı bekleniyor.'],
  ['invalid_boolean', 'true ya da false bekleniyor.'],
  ['out_of_range', 'Koordinat aralık dışında.'],
  ['price_range', 'En düşük fiyat en yüksek fiyattan büyük.'],
  ['too_big', 'Değer çok uzun ya da çok büyük.'],
  ['too_small', 'Değer çok kısa ya da çok küçük.'],
  ['invalid_format', 'Değer biçimi hatalı.'],
  ['unknown_district', 'İl / ilçe bulunamadı.'],
  ['internal_error', 'İçe aktarma tamamlanamadı; yeniden başlatın.'],
]);

export function issueLabel(code: string): string {
  return ISSUE_LABELS.get(code) ?? code;
}

const AUDIT_ACTION_LABELS: ReadonlyMap<string, string> = new Map([
  ['venue.verified', 'Saha onaylandı'],
  ['venue.unverified', 'Saha onayı kaldırıldı'],
  ['venue.corrected', 'Saha bilgisi düzeltildi'],
  ['venue.importRequested', 'Saha içe aktarma başlatıldı'],
  ['venue.imported', 'Saha içe aktarma bitti'],
  ['review.removed', 'Yorum kaldırıldı'],
  ['opencall.removed', 'Eksik oyuncu ilanı kaldırıldı'],
  ['user.roleChanged', 'Kullanıcı rolü değişti'],
  ['user.deactivated', 'Kullanıcı engellendi'],
  ['user.reactivated', 'Kullanıcı engeli kaldırıldı'],
  ['admin.stepUp', 'Ek doğrulama yapıldı'],
  ['admin.stepUpFailed', 'Ek doğrulama başarısız'],
  ['admin.totpEnrollStarted', 'Doğrulama kurulumu başladı'],
  ['admin.totpEnrollFailed', 'Doğrulama kurulumu reddedildi'],
  ['admin.totpEnrolled', 'Doğrulama uygulaması kuruldu'],
  ['admin.totpConfirmFailed', 'Kurulum kodu reddedildi'],
  ['admin.freshTotpFailed', 'İşlem kodu reddedildi'],
]);

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS.get(action) ?? action;
}

const DATE_TIME = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Istanbul',
});

/** "3 Eki 2026 14:05" in Turkey's time zone; the raw value when it does not parse. */
export function formatDateTime(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? iso : DATE_TIME.format(time);
}

/** First block of an id, enough to tell rows apart on screen. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}
