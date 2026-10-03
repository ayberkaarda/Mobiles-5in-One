'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import styles from './admin.module.css';
import { ADMIN_PATHS } from './paths';
import { useAdminMutation } from './use-admin-mutation';

const SECTIONS = [
  { href: ADMIN_PATHS.venues, label: 'Saha onayı', adminOnly: false },
  { href: ADMIN_PATHS.venueImport, label: 'Saha içe aktarma', adminOnly: true },
  { href: ADMIN_PATHS.users, label: 'Kullanıcılar', adminOnly: false },
  { href: ADMIN_PATHS.auditLog, label: 'Denetim kaydı', adminOnly: true },
] as const;

/** The section whose path is the longest prefix of `pathname`. */
export function currentSection(pathname: string): string | null {
  let best: string | null = null;
  for (const { href } of SECTIONS) {
    if (
      (pathname === href || pathname.startsWith(`${href}/`)) &&
      href.length > (best?.length ?? 0)
    ) {
      best = href;
    }
  }
  return best;
}

/** Section links of the panel; admin-only sections are hidden from moderators (the API decides). */
export function PanelNav({ isAdmin }: { readonly isAdmin: boolean }) {
  const pathname = usePathname();
  const current = currentSection(pathname);
  return (
    <nav aria-label="Yönetim bölümleri">
      <ul className={styles.nav}>
        {SECTIONS.filter((section) => isAdmin || !section.adminOnly).map((section) => (
          <li key={section.href}>
            <Link
              href={section.href}
              className={styles.navLink}
              aria-current={current === section.href ? 'page' : undefined}
            >
              {section.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Ends the web session (`POST auth/logout`) and returns to the sign-in page. */
export function SignOutButton({ csrfCookieName }: { readonly csrfCookieName: string }) {
  const router = useRouter();
  const { state, run } = useAdminMutation(csrfCookieName);
  const [failed, setFailed] = useState(false);
  return (
    <>
      <button
        type="button"
        className={styles.secondaryButton}
        aria-disabled={state.status === 'pending'}
        onClick={() => {
          void run({ kind: 'logout', body: {} }).then((outcome) => {
            if (outcome === null) {
              return;
            }
            if (outcome.kind === 'ok') {
              router.replace(ADMIN_PATHS.signIn);
            } else {
              setFailed(true);
            }
          });
        }}
      >
        Çıkış yap
      </button>
      <span role="status" aria-live="polite" className={styles.error}>
        {failed && state.status === 'failure' ? state.message : ''}
      </span>
    </>
  );
}
