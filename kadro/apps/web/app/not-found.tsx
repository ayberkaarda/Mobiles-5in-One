import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';

import { MarketingShell } from '../components/marketing/marketing-shell';
import styles from '../components/marketing/marketing.module.css';

export const metadata: Metadata = {
  title: 'Sayfa bulunamadı · Kadro',
  robots: { index: false, follow: false },
};

/**
 * 404 page (ADR-0021 `app` surface). It renders per request so its scripts carry the CSP nonce of
 * the response; without this call Next.js would prerender it once the root layout stopped making
 * every page dynamic (ADR-0055). It uses the marketing shell (ADR-0056) so a visitor who followed
 * a broken link keeps the site navigation.
 */
export default async function NotFound() {
  await connection();
  return (
    <MarketingShell>
      <div className={styles.statusBlock}>
        <h1 className={styles.pageTitle}>Sayfa bulunamadı</h1>
        <p className={styles.pageLead}>Aradığın sayfa yok ya da taşınmış olabilir.</p>
        <div className={styles.statusActions}>
          <Link href="/" className={styles.buttonSolid}>
            Ana sayfaya dön
          </Link>
          <Link href="/ozellikler" className={styles.inlineLink}>
            Özellikleri incele
          </Link>
        </div>
      </div>
    </MarketingShell>
  );
}
