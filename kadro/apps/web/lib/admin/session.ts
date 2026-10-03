import { type MeResponse, meResponseSchema } from '@kadro/contracts';
import { redirect } from 'next/navigation';
import { cache } from 'react';

import { GET as readMeRoute } from '../../app/api/v1/me/route';
import { serverRuntime } from '../server/runtime';
import { type AdminRead, adminRead } from './server-api';

/**
 * Who is looking at the panel (ADR-0068), read once per request through `GET me` with the
 * browser's cookies. Showing or hiding a section is only a convenience: every admin read and
 * mutation is decided again by the API (staff role, step-up window, admin tier).
 */
export type PanelViewer =
  | { readonly kind: 'staff'; readonly me: MeResponse; readonly isAdmin: boolean }
  | { readonly kind: 'not_staff' }
  | { readonly kind: 'signed_out' }
  | { readonly kind: 'unavailable' };

export function viewerFrom(read: AdminRead<MeResponse>): PanelViewer {
  switch (read.kind) {
    case 'ok':
      return read.data.role === 'user'
        ? { kind: 'not_staff' }
        : { kind: 'staff', me: read.data, isAdmin: read.data.role === 'admin' };
    case 'signed_out':
      return { kind: 'signed_out' };
    case 'forbidden':
      return { kind: 'not_staff' };
    default:
      return { kind: 'unavailable' };
  }
}

export const panelViewer = cache(async (): Promise<PanelViewer> =>
  viewerFrom(await adminRead(readMeRoute, meResponseSchema, { path: '/api/v1/me' })),
);

/** Name of the CSRF cookie the client forms echo in `x-csrf-token`. */
export async function csrfCookieName(): Promise<string> {
  return (await serverRuntime()).env.CSRF_COOKIE_NAME;
}

/** Leaves the page for the sign-in or step-up page when a read says so. */
export function followAuthRedirect<T>(
  read: AdminRead<T>,
): asserts read is Exclude<AdminRead<T>, { kind: 'signed_out' } | { kind: 'step_up' }> {
  if (read.kind === 'signed_out') {
    redirect('/admin/giris');
  }
  if (read.kind === 'step_up') {
    redirect('/admin/dogrulama');
  }
}
