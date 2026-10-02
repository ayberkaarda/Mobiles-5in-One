import { connection } from 'next/server';
import type { ReactNode } from 'react';

/**
 * App surfaces (ADR-0021 group 1): rendered per request so every response carries a fresh CSP
 * nonce. The root layout sets no render mode (ADR-0055), so this call keeps the group dynamic.
 */
export default async function AppSurfaceLayout({ children }: { readonly children: ReactNode }) {
  await connection();
  return children;
}
