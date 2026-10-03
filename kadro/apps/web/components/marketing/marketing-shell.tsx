import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

import { FONT_CLASS, PRELOADED_FONTS } from './fonts';
import styles from './marketing.module.css';
import { NavLink } from './nav-link';
import {
  DOWNLOAD_ANCHOR,
  FOOTER_GROUPS,
  HEADER_LINKS,
  LEGAL_NAME,
  PORTFOLIO_NOTE,
  SITE_TAGLINE,
} from './site';
import { marketingThemeVariables } from './theme';

/** Target of the skip link: the page's `main` landmark. */
export const MAIN_ID = 'icerik';

/**
 * Frame of every marketing page (ADR-0056): skip link, `header` with the primary navigation,
 * one `main` landmark that the skip link focuses, and a `footer` with the secondary navigation.
 * Server-rendered; the only client code is the current-page marker of {@link NavLink}.
 */
export function MarketingShell({ children }: { readonly children: ReactNode }) {
  return (
    <div
      className={`${styles.shell} ${FONT_CLASS}`}
      style={marketingThemeVariables() as CSSProperties}
    >
      {PRELOADED_FONTS.map((href) => (
        <link
          key={href}
          rel="preload"
          href={href}
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      ))}
      <a className={styles.skipLink} href={`#${MAIN_ID}`}>
        İçeriğe geç
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.brand} aria-label="Kadro ana sayfa">
            KADRO
          </Link>
          <nav aria-label="Ana menü" className={styles.nav}>
            <ul className={styles.navList}>
              {HEADER_LINKS.map((link) => (
                <li key={link.href}>
                  <NavLink href={link.href} className={styles.navLink}>
                    {link.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <a href={`/#${DOWNLOAD_ANCHOR}`} className={styles.headerCta}>
            Uygulamayı indir
          </a>
        </div>
      </header>
      <main id={MAIN_ID} tabIndex={-1} className={styles.main}>
        {children}
      </main>
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <p className={styles.footerWordmark}>KADRO</p>
            <p className={styles.footerText}>{SITE_TAGLINE}</p>
          </div>
          <nav aria-label="Alt menü" className={styles.footerNav}>
            {FOOTER_GROUPS.map((group) => (
              <div key={group.title} className={styles.footerGroup}>
                <h2 className={styles.footerTitle}>{group.title}</h2>
                <ul className={styles.footerList}>
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <NavLink href={link.href} className={styles.footerLink}>
                        {link.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          <p className={styles.footerLegal}>
            © {LEGAL_NAME}. {PORTFOLIO_NOTE}
          </p>
        </div>
      </footer>
    </div>
  );
}
