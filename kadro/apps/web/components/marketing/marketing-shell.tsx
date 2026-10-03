import Link from 'next/link';
import type { ReactNode } from 'react';

import { buttonClassName } from './button';
import { cx } from './class-names';
import { FONT_CLASS, PRELOADED_FONTS } from './fonts';
import styles from './marketing.module.css';
import { NavLink } from './nav-link';
import {
  DOWNLOAD_ANCHOR,
  FOOTER_GROUPS,
  HEADER_LINKS,
  PORTFOLIO_NOTE,
  SITE_NAME,
  SITE_TAGLINE,
} from './site';
import { ThemeToggle } from './theme-toggle';
import { Wordmark } from './wordmark';

/** Target of the skip link: the page's `main` landmark. */
export const MAIN_ID = 'icerik';

/**
 * Frame of every marketing page (ADR-0056, ADR-0084): skip link, `header` with the wordmark and
 * the primary navigation, one `main` landmark that the skip link focuses, and a `footer` with the
 * secondary navigation and the Sistem / Açık / Koyu toggle. Server-rendered, no `style`
 * attribute: colours come from `@kadro/brand/theme.css` through the class names, and the scheme
 * from `data-theme` on `<html>`. The client code is the current-page marker of {@link NavLink}
 * and the current path of the toggle form.
 */
export function MarketingShell({ children }: { readonly children: ReactNode }) {
  return (
    <div className={cx(styles.shell, FONT_CLASS)}>
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
            <Wordmark className={styles.brandMark} />
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
          <a
            href={`/#${DOWNLOAD_ANCHOR}`}
            className={cx(buttonClassName('secondary'), styles.headerCta)}
          >
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
            <p className={styles.footerWordmark}>
              <Wordmark title={SITE_NAME} className={styles.footerMark} />
            </p>
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
          <ThemeToggle className={styles.footerTheme} />
          <p className={styles.footerLegal}>
            © {SITE_NAME}. {PORTFOLIO_NOTE}
          </p>
        </div>
      </footer>
    </div>
  );
}
