/**
 * Light-theme colors of `packages/brand/tokens.json` used by the marketing shell (ADR-0056),
 * exposed as `--m-*` custom properties on the shell's `style` attribute, which the page CSP
 * allows through `style-src-attr` (ADR-0055). `marketing.module.css` reads colors only through
 * these properties. `tests/marketing/marketing.test.ts` checks every value against the token file and
 * every pair below against the WCAG minimums.
 */
export const MARKETING_THEME = {
  background: '#F4F6F0',
  surface: '#FFFFFF',
  text: '#0E1A14',
  textMuted: '#5B6B62',
  primary: '#1B7F4B',
  onPrimary: '#FFFFFF',
  accent: '#FF6B1A',
  onAccent: '#0E1A14',
  link: '#1B7F4B',
} as const;

export type MarketingColor = keyof typeof MARKETING_THEME;

/** Foreground/background pairs the shell renders as text (4.5:1, WCAG 1.4.3). */
export const MARKETING_TEXT_PAIRS: readonly (readonly [MarketingColor, MarketingColor])[] = [
  ['text', 'background'],
  ['text', 'surface'],
  ['textMuted', 'background'],
  ['textMuted', 'surface'],
  ['link', 'background'],
  ['link', 'surface'],
  ['onPrimary', 'primary'],
  ['onAccent', 'accent'],
  ['primary', 'surface'],
];

/**
 * Non-text pairs (3:1, WCAG 1.4.11): focus rings, `text` on light areas and `onPrimary` on the
 * primary hero.
 */
export const MARKETING_NON_TEXT_PAIRS: readonly (readonly [MarketingColor, MarketingColor])[] = [
  ['text', 'background'],
  ['text', 'surface'],
  ['onPrimary', 'primary'],
];

/** CSS custom properties for the shell's `style` attribute. */
export function marketingThemeVariables(): Record<`--m-${string}`, string> {
  const variables: Record<`--m-${string}`, string> = {};
  for (const [name, value] of Object.entries(MARKETING_THEME)) {
    variables[`--m-${name}`] = value;
  }
  return variables;
}
