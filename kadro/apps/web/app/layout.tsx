import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Kadro: Halı Saha & Eksik Oyuncu',
  description:
    'Kadro ile halı saha maçını organize et, eksik oyuncuyu mahallenden bul, saha ücretini takip et.',
  applicationName: 'Kadro',
};

export const viewport: Viewport = {
  themeColor: '#1B7F4B',
};

export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  // Pages render per request so Next.js can apply the CSP nonce set by proxy.ts to its scripts
  // (security checklist item 9); a prerendered page cannot carry a per-request nonce.
  await connection();
  return (
    <html lang="tr">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          backgroundColor: '#F4F6F0',
          color: '#0E1A14',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        {children}
      </body>
    </html>
  );
}
