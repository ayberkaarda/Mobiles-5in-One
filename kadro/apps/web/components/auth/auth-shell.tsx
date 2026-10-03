import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

import { Wordmark } from '../marketing/wordmark';
import { themeVariables } from '../../lib/client/theme';
import styles from './auth.module.css';

/**
 * Server-rendered frame of the email-link pages: one `main` landmark, the wordmark link home and
 * the page's only `h1`.
 */
export function AuthShell({
  title,
  lead,
  children,
}: {
  readonly title: string;
  readonly lead?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className={styles.page} style={themeVariables() as CSSProperties}>
      <main className={styles.card}>
        <Link href="/" className={styles.brand} aria-label="Kadro ana sayfa">
          <Wordmark />
        </Link>
        <h1 className={styles.title}>{title}</h1>
        {lead === undefined ? null : <p className={styles.lead}>{lead}</p>}
        {children}
      </main>
    </div>
  );
}
