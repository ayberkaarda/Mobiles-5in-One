import { isApiError } from '@inecekvar/data-access';
import { FACTS } from '../../content/facts';

export type DeletionFailure =
  | 'offline'
  | 'wrong-password'
  | 'reauth-required'
  | 'rate-limited'
  | 'last-admin'
  | 'session-ended'
  | 'error';

export type SignInFailure = 'offline' | 'invalid' | 'rate-limited' | 'error';

/**
 * Classifies a failed `DELETE me` (ADR-0026). Only the HTTP status and the problem `code` are
 * read; problem bodies, `detail` and request ids are never shown, so nothing the server or an
 * attacker controls reaches the page as text.
 */
export function deletionFailure(error: unknown): DeletionFailure {
  if (!isApiError(error)) return 'error';
  if (error.kind === 'network' || error.kind === 'timeout') return 'offline';
  if (error.status === 429) return 'rate-limited';
  if (error.code === 'auth.invalid_credentials') return 'wrong-password';
  if (error.code === 'auth.reauth_required') return 'reauth-required';
  if (error.code === 'admin.last_admin') return 'last-admin';
  if (error.status === 401) return 'session-ended';
  return 'error';
}

export function signInFailure(error: unknown): SignInFailure {
  if (!isApiError(error)) return 'error';
  if (error.kind === 'network' || error.kind === 'timeout') return 'offline';
  if (error.status === 429) return 'rate-limited';
  if (error.status === 401) return 'invalid';
  return 'error';
}

export function retryAfterOf(error: unknown): number | null {
  return isApiError(error) ? error.retryAfterSeconds : null;
}

function rateLimited(seconds: number | null): string {
  return seconds === null
    ? 'Çok fazla deneme. Biraz bekleyip yeniden dene.'
    : `Çok fazla deneme. ${seconds} sn sonra yeniden dene.`;
}

/** Copy for a failed deletion; the wording follows the app (Ayarlar, Hesap). */
export function deletionMessage(failure: DeletionFailure, retryAfter: number | null): string {
  switch (failure) {
    case 'offline':
      return 'İnternet yok ya da sunucuya ulaşılamıyor. Silme isteği sunucuya ulaşmadan hiçbir şey silinmez; bağlantı gelince yeniden dene.';
    case 'wrong-password':
      return 'Şifre doğru değil. Hesabın olduğu gibi duruyor; oturumun açık, yeniden deneyebilirsin.';
    case 'reauth-required':
      return 'Güvenlik için yeniden giriş yapman gerekiyor. Çıkış yapıp şifrenle yeniden gir.';
    case 'rate-limited':
      return rateLimited(retryAfter);
    case 'last-admin':
      return 'Bu hesap son yönetici hesabı; önce başka bir hesaba yönetici rolü verilmeli. Hesabın olduğu gibi duruyor.';
    case 'session-ended':
      return `Oturumun kapandı; silme isteği gönderilmedi. Hesap başka bir sekmede ya da cihazda silinmiş veya çıkış yapılmış olabilir. Silme isteğin daha önce alındıysa ${FACTS.deletion.graceDays} gün içinde yeniden giriş yapma: giriş yapmak isteği iptal eder.`;
    case 'error':
      return 'Silme isteği gönderilemedi; hesabın olduğu gibi duruyor. Biraz sonra yeniden dene.';
  }
}

export function signInMessage(failure: SignInFailure, retryAfter: number | null): string {
  switch (failure) {
    case 'offline':
      return 'İnternet yok ya da sunucuya ulaşılamıyor. Bağlantı gelince yeniden dene.';
    case 'invalid':
      return 'E-posta ya da şifre yanlış.';
    case 'rate-limited':
      return rateLimited(retryAfter);
    case 'error':
      return 'Giriş yapılamadı. Biraz sonra yeniden dene.';
  }
}
