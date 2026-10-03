import { type PlatformRole } from '@kadro/contracts';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

import { themeVariables } from '../../lib/client/theme';
import styles from './admin.module.css';
import { roleLabel } from './labels';
import { PanelNav, SignOutButton } from './panel-nav';
import { ADMIN_PATHS } from './paths';

/**
 * Outer frame of every staff page: theme variables and one `main` landmark per page. The panel
 * stays in the light scheme whatever the visitor's scheme is (`data-theme="light"` re-scopes the
 * brand colour roles for everything inside).
 */
export function AdminPage({ children }: { readonly children: ReactNode }) {
  return (
    <div className={styles.page} data-theme="light" style={themeVariables() as CSSProperties}>
      {children}
    </div>
  );
}

/** Narrow card for sign-in, step-up and enrollment. */
export function AdminCard({
  title,
  lead,
  children,
}: {
  readonly title: string;
  readonly lead?: string;
  readonly children: ReactNode;
}) {
  return (
    <main className={styles.narrow}>
      <Link href={ADMIN_PATHS.signIn} className={styles.brand} aria-label="Kadro yönetim girişi">
        KADRO YÖNETİM
      </Link>
      <h1 className={styles.title}>{title}</h1>
      {lead === undefined ? null : <p className={styles.lead}>{lead}</p>}
      {children}
    </main>
  );
}

/** Header with the section links and the signed-in account, then the page. */
export function PanelFrame({
  displayName,
  role,
  csrfCookieName,
  children,
}: {
  readonly displayName: string;
  readonly role: PlatformRole;
  readonly csrfCookieName: string;
  readonly children: ReactNode;
}) {
  return (
    <>
      <header className={styles.header}>
        <Link href={ADMIN_PATHS.venues} className={styles.brand} aria-label="Yönetim paneli">
          KADRO YÖNETİM
        </Link>
        <PanelNav isAdmin={role === 'admin'} />
        <div className={styles.account}>
          <span>
            {displayName}, {roleLabel(role)}
          </span>
          <SignOutButton csrfCookieName={csrfCookieName} />
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </>
  );
}

/** Shown instead of a page section the API refused. */
export function Notice({ children }: { readonly children: ReactNode }) {
  return <p className={styles.notice}>{children}</p>;
}

export function PageHeading({ title, lead }: { readonly title: string; readonly lead?: string }) {
  return (
    <>
      <h1 className={styles.title}>{title}</h1>
      {lead === undefined ? null : <p className={styles.lead}>{lead}</p>}
    </>
  );
}

/** Message for reads that are neither data nor an auth redirect. */
export function readProblemMessage(
  kind: 'forbidden' | 'not_found' | 'invalid' | 'unavailable',
): string {
  switch (kind) {
    case 'forbidden':
      return 'Bu bölüm için yetkin yok.';
    case 'not_found':
      return 'Kayıt bulunamadı.';
    case 'invalid':
      return 'Filtre ya da sayfa bağlantısı geçersiz. Filtreleri temizleyip tekrar dene.';
    case 'unavailable':
      return 'Şu an veriler yüklenemedi. Biraz sonra tekrar dene.';
  }
}
