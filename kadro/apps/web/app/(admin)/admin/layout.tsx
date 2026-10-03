import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

import { AdminPage } from '../../../components/admin/frames';

/**
 * Staff panel (ADR-0068, security checklist item 18). Rendered per request so every response
 * carries a fresh CSP nonce; the proxy also sends `X-Robots-Tag: noindex, nofollow`,
 * `Referrer-Policy: no-referrer` and `Cache-Control: no-store` for `/admin/**` (surface `admin`).
 */
export const metadata: Metadata = {
  title: { default: 'Yönetim · Kadro', template: '%s · Kadro Yönetim' },
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function AdminLayout({ children }: { readonly children: ReactNode }) {
  await connection();
  return <AdminPage>{children}</AdminPage>;
}
