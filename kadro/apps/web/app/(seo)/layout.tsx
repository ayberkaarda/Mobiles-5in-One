import { loadWebEnv } from '@kadro/config';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

import { MarketingShell } from '../../components/marketing/marketing-shell';
import { marketingLayoutMetadata } from '../../components/marketing/metadata';

/**
 * SEO surface: programmatic venue and district pages (ADR-0021 group 2, ADR-0055, ADR-0057).
 * Rendered per request so every response carries the CSP nonce of the proxy; the database reads
 * behind the pages are cached instead (`lib/server/seo/data.ts`). Same frame and metadata
 * defaults as the marketing pages (ADR-0056).
 */
export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return marketingLayoutMetadata(loadWebEnv().WEB_ORIGIN);
}

export default async function SeoLayout({ children }: { readonly children: ReactNode }) {
  await connection();
  return <MarketingShell>{children}</MarketingShell>;
}
