'use client';

import { usePathname } from 'next/navigation';

import styles from './primitives.module.css';
import { THEME_FIELD, THEME_OPTIONS, THEME_RETURN_FIELD, THEME_ROUTE } from './theme';
import { useThemePreference } from './theme-context';

/**
 * ThemeToggle: the Sistem / Açık / Koyu control of the footer (ADR-0084, direction §4.11).
 *
 * A plain form that posts to `/tema`; each option is a submit button carrying its value, the
 * hidden `geri` field carries the current path, and the server answers 303 back to it with the
 * cookie set. It needs no JavaScript: the markup, including the current path and the pressed
 * option, comes from the server render. Props: `className` (optional, extra class on the form).
 */
export function ThemeToggle({ className }: { readonly className?: string | undefined }) {
  const pathname = usePathname();
  const current = useThemePreference();
  return (
    <form
      method="post"
      action={THEME_ROUTE}
      className={
        className === undefined ? styles.themeToggle : `${styles.themeToggle} ${className}`
      }
    >
      <input type="hidden" name={THEME_RETURN_FIELD} value={pathname} />
      <fieldset className={styles.themeFieldset}>
        <legend className={styles.themeLegend}>Görünüm</legend>
        <div className={styles.themeOptions}>
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="submit"
              name={THEME_FIELD}
              value={option.value}
              aria-pressed={option.value === current}
              className={styles.themeOption}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>
    </form>
  );
}
