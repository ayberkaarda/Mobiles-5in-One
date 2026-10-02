/**
 * Navigation targets of the email-link pages. Every target is a constant from this file; user
 * input (query parameters, fragments, API responses) can only select one of them by exact match,
 * so no page can be turned into an open redirect.
 */

export const PAGE_PATHS = {
  home: '/',
  verifyEmail: '/e-posta-dogrula',
  reset: '/sifre-sifirla',
  forgot: '/sifremi-unuttum',
  login: '/giris',
  deleteAccount: '/hesap-silme',
} as const;

/** Where `/giris` may send the user after signing in, selected by its `?devam=` parameter. */
export const AFTER_LOGIN_TARGETS = [PAGE_PATHS.home, PAGE_PATHS.deleteAccount] as const;
export type AfterLoginTarget = (typeof AFTER_LOGIN_TARGETS)[number];

/**
 * Returns `candidate` when it is exactly one of the allowed targets, otherwise `/`. Arrays (a
 * repeated parameter), absolute URLs, protocol-relative and backslash paths, encoded variants
 * and anything with a query or fragment all fall back.
 */
export function afterLoginTarget(candidate: unknown): AfterLoginTarget {
  if (typeof candidate !== 'string') {
    return PAGE_PATHS.home;
  }
  for (const target of AFTER_LOGIN_TARGETS) {
    if (candidate === target) {
      return target;
    }
  }
  return PAGE_PATHS.home;
}
