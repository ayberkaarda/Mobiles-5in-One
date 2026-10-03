import { AUTH_CLIENT_HEADER, CSRF_HEADER } from '@kadro/contracts';

import { type ApiOutcome, type ApiRequest, sendApiRequest } from '../client/api';
import { readCookieValue } from '../client/cookies';
import { rateLimitMessage } from '../client/messages';

/**
 * Browser transport of the admin panel (ADR-0068): same-origin JSON requests to fixed
 * `/api/v1/admin` paths with `x-kadro-client: web` and the double-submit CSRF header read from
 * the CSRF cookie (ADR-0014). Ids in paths are checked against the id format first, so no input
 * can change the path. Results are reduced to Turkish messages chosen by the problem code; the
 * panel never shows server text.
 */

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isId(value: string): boolean {
  return ID.test(value);
}

function idSegment(id: string): string {
  if (!isId(id)) {
    throw new TypeError('invalid id');
  }
  return id.toLowerCase();
}

/** Every admin mutation the panel sends. */
export type AdminMutation =
  | { readonly kind: 'login'; readonly body: { email: string; password: string } }
  | { readonly kind: 'logout'; readonly body: Record<string, never> }
  | { readonly kind: 'stepUp'; readonly body: { totpCode: string } }
  | { readonly kind: 'totpEnroll'; readonly body: { password: string } }
  | { readonly kind: 'totpConfirm'; readonly body: { totpCode: string } }
  | { readonly kind: 'verifyVenue'; readonly id: string; readonly body: { verified: boolean } }
  | { readonly kind: 'importVenues'; readonly body: { csv: string; dryRun: boolean } }
  | {
      readonly kind: 'setRole';
      readonly id: string;
      readonly body: { role: 'user' | 'moderator' | 'admin'; totpCode: string };
    }
  | {
      readonly kind: 'setDeactivated';
      readonly id: string;
      readonly body: { deactivated: boolean; totpCode: string };
    };

export function mutationTarget(mutation: AdminMutation): {
  readonly path: string;
  readonly method: 'POST' | 'PATCH';
} {
  switch (mutation.kind) {
    case 'login':
      return { path: '/api/v1/auth/login', method: 'POST' };
    case 'logout':
      return { path: '/api/v1/auth/logout', method: 'POST' };
    case 'stepUp':
      return { path: '/api/v1/admin/step-up', method: 'POST' };
    case 'totpEnroll':
      return { path: '/api/v1/admin/totp/enroll', method: 'POST' };
    case 'totpConfirm':
      return { path: '/api/v1/admin/totp/confirm', method: 'POST' };
    case 'verifyVenue':
      return { path: `/api/v1/admin/venues/${idSegment(mutation.id)}`, method: 'PATCH' };
    case 'importVenues':
      return { path: '/api/v1/admin/venues/import', method: 'POST' };
    case 'setRole':
      return { path: `/api/v1/admin/users/${idSegment(mutation.id)}/role`, method: 'PATCH' };
    case 'setDeactivated':
      return {
        path: `/api/v1/admin/users/${idSegment(mutation.id)}/deactivate`,
        method: 'PATCH',
      };
  }
}

/**
 * Builds the request. Sign-in is the only call without a session, so it carries no CSRF header;
 * every other call needs `csrfToken`.
 */
export function buildAdminRequest(mutation: AdminMutation, csrfToken: string | null): ApiRequest {
  const { path, method } = mutationTarget(mutation);
  const headers = new Headers({
    accept: 'application/json',
    'content-type': 'application/json',
  });
  headers.set(AUTH_CLIENT_HEADER, 'web');
  if (mutation.kind !== 'login') {
    if (csrfToken === null || csrfToken === '') {
      throw new TypeError('admin mutations need the CSRF token');
    }
    headers.set(CSRF_HEADER, csrfToken);
  }
  return {
    url: path,
    init: {
      method,
      headers,
      body: JSON.stringify(mutation.body),
      credentials: 'same-origin',
      mode: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    },
  };
}

/** Sends `mutation` from the page with the CSRF cookie named `csrfCookieName`. */
export function sendAdminMutation(
  mutation: AdminMutation,
  csrfCookieName: string,
): Promise<ApiOutcome> {
  const csrfToken =
    mutation.kind === 'login' ? null : readCookieValue(document.cookie, csrfCookieName);
  if (mutation.kind !== 'login' && csrfToken === null) {
    return Promise.resolve({ kind: 'problem', status: 403, code: 'csrf_failed' });
  }
  return sendApiRequest((url, init) => fetch(url, init), buildAdminRequest(mutation, csrfToken));
}

/** What the page does after a failed mutation, besides showing the message. */
export type FailureAction = 'none' | 'sign_in' | 'step_up';

export interface AdminFailure {
  readonly message: string;
  readonly action: FailureAction;
}

/** Turkish message for a failed outcome of `kind`; `null` for success. */
export function adminFailure(
  kind: AdminMutation['kind'],
  outcome: ApiOutcome,
): AdminFailure | null {
  switch (outcome.kind) {
    case 'ok':
      return null;
    case 'network':
      return {
        message: 'Bağlantı kurulamadı. İnternet bağlantını kontrol edip tekrar dene.',
        action: 'none',
      };
    case 'rate_limited':
      return { message: rateLimitMessage(outcome.retryAfterSeconds), action: 'none' };
    case 'problem':
      break;
  }
  const { status, code } = outcome;
  switch (code) {
    case 'invalid_credentials':
      return kind === 'login'
        ? { message: 'E-posta ya da şifre hatalı.', action: 'none' }
        : { message: 'Şifren doğrulanamadı. Tekrar dene.', action: 'none' };
    case 'reauth_required':
      return { message: 'Şifren doğrulanamadı. Tekrar dene.', action: 'none' };
    case 'unauthenticated':
    case 'account_deactivated':
    case 'csrf_failed':
      return kind === 'login'
        ? { message: 'Bu hesapla şu an giriş yapılamıyor.', action: 'none' }
        : { message: 'Oturumun sona erdi. Tekrar giriş yap.', action: 'sign_in' };
    case 'step_up_required':
      return {
        message: 'Doğrulama süren doldu. Devam etmek için kodunu yeniden gir.',
        action: 'step_up',
      };
    case 'totp_invalid':
      return {
        message: 'Kod hatalı ya da süresi geçmiş. Uygulamadaki yeni kodu gir.',
        action: 'none',
      };
    case 'totp_not_enrolled':
      return kind === 'totpConfirm'
        ? {
            message: 'Kurulum süresi doldu ya da yenilendi. Kurulumu baştan başlat.',
            action: 'none',
          }
        : {
            message: 'Bu hesap için doğrulama uygulaması kurulmamış. Önce kurulumu tamamla.',
            action: 'none',
          };
    case 'totp_already_enrolled':
      return { message: 'Bu hesapta doğrulama uygulaması zaten kurulu.', action: 'none' };
    case 'forbidden':
      return { message: 'Bu işlem için yetkin yok.', action: 'none' };
    case 'last_admin':
      return { message: 'Son aktif yönetici değiştirilemez.', action: 'none' };
    case 'deletion_pending':
      return {
        message: 'Kullanıcının kendi silme talebi sürüyor; engeli yalnızca kullanıcı kaldırabilir.',
        action: 'none',
      };
    case 'not_found':
      return { message: 'Kayıt bulunamadı. Sayfayı yenileyip tekrar dene.', action: 'none' };
    case 'venue_exists':
      return { message: 'Bu ilçede aynı adlı bir saha zaten var.', action: 'none' };
    case 'payload_too_large':
      return { message: 'Dosya çok büyük. En fazla 1 MB yükleyebilirsin.', action: 'none' };
    case 'service_unavailable':
      return {
        message: 'İki adımlı doğrulama bu ortamda yapılandırılmamış.',
        action: 'none',
      };
    default:
      if (status === 400) {
        return { message: 'Girdiğin bilgileri kontrol edip tekrar dene.', action: 'none' };
      }
      return { message: 'Şu an işlemi tamamlayamadık. Biraz sonra tekrar dene.', action: 'none' };
  }
}

/** A six-digit code as typed: spaces removed; `null` unless exactly six digits remain. */
export function normalizeTotpCode(value: string): string | null {
  const compact = value.replace(/\s+/g, '');
  return /^[0-9]{6}$/.test(compact) ? compact : null;
}
