import { loadWebEnv } from '@kadro/config';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

import { MarketingShell } from '../../components/marketing/marketing-shell';
import { marketingLayoutMetadata } from '../../components/marketing/metadata';

/**
 * Marketing surface (ADR-0021 group 2, ADR-0055, ADR-0056). Rendered per request so every
 * response carries the CSP nonce of the proxy; `tests/built-server.test.ts` fails the build if a
 * page of this group is prerendered. Metadata waits for the request too, so `next build` never
 * reads the configuration.
 */
export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return marketingLayoutMetadata(loadWebEnv().WEB_ORIGIN);
}

export default async function MarketingLayout({ children }: { readonly children: ReactNode }) {
  await connection();
  return <MarketingShell>{children}</MarketingShell>;
}
