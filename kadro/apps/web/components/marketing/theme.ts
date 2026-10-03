/**
 * Colour scheme of the web surfaces (ADR-0084, `@kadro/brand` README "Scheme switching").
 *
 * Colours come only from `@kadro/brand/theme.css`, imported once by the root layout: light values
 * on `:root` and `[data-theme='light']`, dark values on `[data-theme='dark']` and, inside
 * `prefers-color-scheme: dark`, on `[data-theme='system']`. The root layout renders
 * `<html data-theme>` from the {@link THEME_COOKIE} cookie on the server, so the first paint is in
 * the right scheme without any inline script; the footer toggle posts to {@link THEME_ROUTE}.
 * Stylesheets read `--k-color-<role>` (kebab case) only. The constants below mirror
 * `theming` of `packages/brand/theme/tokens.json`; `tests/marketing/marketing.test.ts` compares
 * them with the token file.
 */

/** What the visitor picked; `system` follows `prefers-color-scheme`. */
export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

/** Cookie that stores the preference (`Path=/`, `SameSite=Lax`, `Secure`, `HttpOnly`). */
export const THEME_COOKIE = 'kadro-theme';

export const THEME_COOKIE_MAX_AGE_DAYS = 365;

/** Toggle labels, in the order the toggle shows them. */
export const THEME_LABELS: Readonly<Record<ThemePreference, string>> = {
  system: 'Sistem',
  light: 'Açık',
  dark: 'Koyu',
};

/** The toggle's options in display order: value and label. */
export const THEME_OPTIONS: readonly { readonly value: ThemePreference; readonly label: string }[] =
  [
    { value: 'system', label: THEME_LABELS.system },
    { value: 'light', label: THEME_LABELS.light },
    { value: 'dark', label: THEME_LABELS.dark },
  ];

/** `<meta name="theme-color">` per scheme (`theming.web.themeColor`). */
export const THEME_COLOR = { light: '#F5F6F1', dark: '#0C1611' } as const;

/** `<meta name="color-scheme">` (`theming.web.metaColorScheme`). */
export const COLOR_SCHEME_META = 'light dark';

/** Same-origin route handler that stores the preference (`app/tema/route.ts`). */
export const THEME_ROUTE = '/tema';

/** Form field with the chosen preference. */
export const THEME_FIELD = 'tema';

/** Form field with the path to return to after the preference is stored. */
export const THEME_RETURN_FIELD = 'geri';

/**
 * Colour-role pairs the marketing stylesheets render as text: `[foreground, background]`, role
 * names of the brand tokens. Each must be a pair of `contrast.pairs` of the brand token file and
 * meet 4.5:1 in both schemes (`tests/marketing/marketing.test.ts`).
 */
export const MARKETING_TEXT_PAIRS: readonly (readonly [string, string])[] = [
  ['text', 'background'],
  ['text', 'surface'],
  ['text', 'surfaceSunken'],
  ['text', 'surfaceRaised'],
  ['text', 'fillMuted'],
  ['textMuted', 'background'],
  ['textMuted', 'surface'],
  ['textMuted', 'surfaceSunken'],
  ['primaryText', 'background'],
  ['primaryText', 'surface'],
  ['link', 'background'],
  ['link', 'surface'],
  ['link', 'surfaceSunken'],
  ['onInverse', 'inverse'],
  ['onPrimary', 'primary'],
  ['onAccent', 'accent'],
  ['onPitch', 'pitch'],
  ['onPitchMarker', 'pitchMarker'],
];

/**
 * Non-text pairs (3:1, WCAG 1.4.11): control outlines, the focus ring, button fills against
 * their ground, chalk lines and markers on the turf. Each must be a pair of
 * `contrast.nonTextPairs` of the brand token file in both schemes.
 */
export const MARKETING_NON_TEXT_PAIRS: readonly (readonly [string, string])[] = [
  ['borderStrong', 'background'],
  ['borderStrong', 'surface'],
  ['borderStrong', 'surfaceSunken'],
  ['focusRing', 'background'],
  ['focusRing', 'surface'],
  ['focusRing', 'surfaceSunken'],
  ['primary', 'background'],
  ['primary', 'surface'],
  ['accent', 'background'],
  ['accent', 'surface'],
  ['pitchLine', 'pitch'],
  ['pitchMarker', 'pitch'],
];

/** The preference named by `value`, or `null` when it is not one of {@link THEME_PREFERENCES}. */
export function parseThemePreference(value: unknown): ThemePreference | null {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value)
    ? (value as ThemePreference)
    : null;
}

/** The preference of a cookie value; a missing or unknown value falls back to `system`. */
export function themePreferenceFromCookie(value: string | undefined): ThemePreference {
  return parseThemePreference(value) ?? DEFAULT_THEME_PREFERENCE;
}

/** The `theme.css` custom property of a colour role: `surfaceSunken` → `--k-color-surface-sunken`. */
export function brandColorVariable(role: string): `--k-color-${string}` {
  return `--k-color-${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}
