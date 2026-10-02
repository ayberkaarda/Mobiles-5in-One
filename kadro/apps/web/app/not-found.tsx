import type { Metadata } from 'next';
import { connection } from 'next/server';

export const metadata: Metadata = {
  title: 'Sayfa bulunamadı · Kadro',
  robots: { index: false, follow: false },
};

/**
 * 404 page (ADR-0021 `app` surface). It renders per request so its scripts carry the CSP nonce of
 * the response; without this call Next.js would prerender it once the root layout stopped making
 * every page dynamic (ADR-0055).
 */
export default async function NotFound() {
  await connection();
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '96px 24px' }}>
      <h1 style={{ fontSize: 28, margin: 0 }}>Sayfa bulunamadı</h1>
      <p style={{ fontSize: 17, lineHeight: 1.6, color: '#5B6B62' }}>
        Aradığın sayfa yok ya da taşınmış olabilir.
      </p>
    </main>
  );
}
