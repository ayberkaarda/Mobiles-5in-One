import type { Route } from 'next';

import { isId } from '../../lib/admin/client-api';

/** Every page of the staff panel (ADR-0068). Navigation targets are these constants only. */
export const ADMIN_PATHS = {
  home: '/admin',
  signIn: '/admin/giris',
  stepUp: '/admin/dogrulama',
  enroll: '/admin/totp-kurulum',
  venues: '/admin/sahalar',
  venueImport: '/admin/sahalar/ice-aktar',
  users: '/admin/kullanicilar',
  auditLog: '/admin/denetim',
} as const satisfies Record<string, Route>;

/** Status page of one import; `null` for anything that is not an id. */
export function importStatusPath(importId: string): Route | null {
  return isId(importId) ? (`${ADMIN_PATHS.venueImport}/${importId.toLowerCase()}` as Route) : null;
}

/** `path` with the non-empty `query` entries, for pagination and filter links. */
export function withQuery(
  path: string,
  query: Readonly<Record<string, string | undefined>>,
): Route {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') {
      params.set(key, value);
    }
  }
  const search = params.toString();
  return (search === '' ? path : `${path}?${search}`) as Route;
}
