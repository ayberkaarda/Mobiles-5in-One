import { connection } from 'next/server';
import type { ReactNode } from 'react';

/**
 * App surfaces (ADR-0021 group 1): rendered per request so every response carries a fresh CSP
 * nonce. The root layout makes the same call today; this one keeps the group dynamic once the
 * root layout stops doing so for the static marketing pages.
 */
export default async function AppSurfaceLayout({ children }: { readonly children: ReactNode }) {
  await connection();
  return children;
}
