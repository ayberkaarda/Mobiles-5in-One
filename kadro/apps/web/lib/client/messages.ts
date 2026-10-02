import { LIMITS } from '@kadro/contracts';

import { type Failure, type FlowState } from './flow';

/**
 * User-facing copy of the email-link pages (Turkish, friendly "sen", short). Messages depend
 * only on the failure kind, never on server text, and never say whether an account or a token
 * exists (ADR-0015, ADR-0040).
 */

/** "30 saniye", "2 dakika", "1 saat": rounded up so the user never retries too early. */
export function formatWait(seconds: number): string {
  const safe = Math.max(1, Math.ceil(seconds));
  if (safe < 60) {
    return `${safe} saniye`;
  }
  if (safe < 3600) {
    return `${Math.ceil(safe / 60)} dakika`;
  }
  return `${Math.ceil(safe / 3600)} saat`;
}

export function rateLimitMessage(retryAfterSeconds: number | null): string {
  if (retryAfterSeconds === null) {
    return 'Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.';
  }
  return `Çok fazla deneme yapıldı. ${formatWait(retryAfterSeconds)} sonra tekrar dene.`;
}

const FAILURE_MESSAGES: Readonly<Record<Exclude<Failure, 'rate_limited'>, string>> = {
  link_invalid: 'Bu bağlantı geçersiz ya da süresi dolmuş. Yeni bir bağlantı iste.',
  invalid_credentials: 'E-posta ya da şifre hatalı.',
  account_deactivated: 'Bu hesapla şu an giriş yapılamıyor.',
  password_breached: 'Bu şifre daha önce bir veri sızıntısında görülmüş. Başka bir şifre seç.',
  validation: 'Girdiğin bilgileri kontrol edip tekrar dene.',
  signed_out: 'Devam etmek için önce giriş yap.',
  reauth_failed: 'Şifren doğrulanamadı. Tekrar dene.',
  step_up_required: 'Bu hesap ek doğrulama istiyor. Silme işlemini uygulamadan başlat.',
  deletion_pending: 'Hesabın için zaten bir silme talebi var.',
  last_admin: 'Son yönetici hesabı silinemez.',
  network: 'Bağlantı kurulamadı. İnternet bağlantını kontrol edip tekrar dene.',
  unavailable: 'Şu an işlemi tamamlayamadık. Biraz sonra tekrar dene.',
};

const FAILURE_MESSAGE_MAP: ReadonlyMap<Failure, string> = new Map(
  Object.entries(FAILURE_MESSAGES) as [Failure, string][],
);

export function failureMessage(failure: Failure, retryAfterSeconds: number | null): string {
  if (failure === 'rate_limited') {
    return rateLimitMessage(retryAfterSeconds);
  }
  return FAILURE_MESSAGE_MAP.get(failure) ?? FAILURE_MESSAGES.unavailable;
}

/** Copy of one page: what to announce while a request runs and after it succeeds. */
export interface PageCopy {
  readonly pending: string;
  readonly success: string;
}

export const PAGE_COPY = {
  verifyEmail: {
    pending: 'E-posta adresin doğrulanıyor…',
    success: 'E-posta adresin doğrulandı. Artık giriş yapabilirsin.',
  },
  reset: {
    pending: 'Şifren güncelleniyor…',
    success: 'Şifren güncellendi. Güvenliğin için tüm oturumlardan çıkış yapıldı.',
  },
  forgot: {
    pending: 'Gönderiliyor…',
    // Identical for every address (ADR-0015).
    success:
      'Bu adres bir Kadro hesabına aitse şifre sıfırlama bağlantısını gönderdik. Gelen kutunu ve spam klasörünü kontrol et.',
  },
  login: {
    pending: 'Giriş yapılıyor…',
    success: 'Giriş yaptın. Yönlendiriliyorsun…',
  },
  deleteAccount: {
    pending: 'Silme talebin gönderiliyor…',
    success: 'Silme talebin alındı.',
  },
} as const satisfies Record<string, PageCopy>;

/** Text for the `aria-live` region; empty while idle so nothing is announced on load. */
export function announcement(state: FlowState, copy: PageCopy): string {
  switch (state.status) {
    case 'idle':
      return '';
    case 'pending':
      return copy.pending;
    case 'success':
      return copy.success;
    case 'failure':
      return failureMessage(state.failure, state.retryAfterSeconds);
  }
}

export const PASSWORD_RULE = `En az ${LIMITS.password.min} karakter.`;
