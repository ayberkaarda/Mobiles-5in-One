/**
 * Colour names of the email-link pages (`components/auth/auth.module.css`) and the staff panel
 * (`components/admin/admin.module.css`), mapped to the brand colour roles of
 * `packages/brand/theme/tokens.json` (ADR-0084). The page shells put {@link themeVariables} on
 * their `style` attribute (allowed by `style-src-attr`): each `--k-<name>` points at the
 * `--k-color-<role>` property of `@kadro/brand/theme.css`, so the pages follow the scheme set by
 * `data-theme` on `<html>` without a literal colour anywhere. `tests/pages/redirects-and-a11y.test.ts`
 * checks every pair below in both schemes against the token file.
 */
export const THEME_ROLES = {
  background: 'background',
  surface: 'surface',
  text: 'text',
  textMuted: 'textMuted',
  primary: 'primary',
  onPrimary: 'onPrimary',
  danger: 'dangerText',
  link: 'link',
} as const;

export type ThemeColor = keyof typeof THEME_ROLES;

/** Foreground/background pairs the pages render as text (4.5:1). */
export const TEXT_PAIRS: readonly (readonly [ThemeColor, ThemeColor])[] = [
  ['text', 'background'],
  ['text', 'surface'],
  ['textMuted', 'surface'],
  ['textMuted', 'background'],
  ['onPrimary', 'primary'],
  ['onPrimary', 'danger'],
  ['onPrimary', 'text'],
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

/** `surfaceSunken` → `--k-color-surface-sunken`. */
function roleVariable(role: string): string {
  return `--k-color-${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/** CSS custom properties for the shell's `style` attribute: `--k-text: var(--k-color-text)`. */
export function themeVariables(): Record<`--k-${string}`, string> {
  const variables: Record<`--k-${string}`, string> = {};
  for (const [name, role] of Object.entries(THEME_ROLES)) {
    variables[`--k-${name}`] = `var(${roleVariable(role)})`;
  }
  return variables;
}
