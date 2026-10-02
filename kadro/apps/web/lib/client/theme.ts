/**
 * Light-theme colors of `packages/brand/tokens.json` used by the email-link pages, exposed as CSS
 * custom properties on the page shell. `tests/pages/theme.test.ts` checks every value against
 * the token file and every text/background pair the pages render against the 4.5:1 minimum.
 */
export const THEME = {
  background: '#F4F6F0',
  surface: '#FFFFFF',
  text: '#0E1A14',
  textMuted: '#5B6B62',
  primary: '#1B7F4B',
  onPrimary: '#FFFFFF',
  danger: '#D7263D',
  link: '#1B7F4B',
} as const;

export type ThemeColor = keyof typeof THEME;

/** Foreground/background pairs the pages render as text. */
export const TEXT_PAIRS: readonly (readonly [ThemeColor, ThemeColor])[] = [
  ['text', 'background'],
  ['text', 'surface'],
  ['textMuted', 'surface'],
  ['textMuted', 'background'],
  ['onPrimary', 'primary'],
  ['link', 'surface'],
  ['link', 'background'],
  ['danger', 'surface'],
  ['primary', 'surface'],
];

/** Non-text pairs (focus ring, input borders) need 3:1 (WCAG 1.4.11). */
export const NON_TEXT_PAIRS: readonly (readonly [ThemeColor, ThemeColor])[] = [
  ['text', 'surface'],
  ['textMuted', 'surface'],
  ['primary', 'background'],
];

/** CSS custom properties for the shell's `style` attribute (allowed by `style-src-attr`). */
export function themeVariables(): Record<`--k-${string}`, string> {
  const variables: Record<`--k-${string}`, string> = {};
  for (const [name, value] of Object.entries(THEME)) {
    variables[`--k-${name}`] = value;
  }
  return variables;
}
