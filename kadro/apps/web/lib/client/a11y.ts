import { LIMITS } from '@kadro/contracts';

/**
 * Accessibility and form helpers of the email-link pages (WCAG 2.2 AA, ADR-0040).
 */

/** Smallest pointer target the pages render (WCAG 2.5.8 asks for 24 px; buttons use 44 px). */
export const MIN_TARGET_PX = 24;
export const BUTTON_TARGET_PX = 44;

/** Minimum contrast for normal text (WCAG 1.4.3). */
export const MIN_CONTRAST = 4.5;

/** Joins the ids of the elements that describe a field, skipping absent ones. */
export function describedBy(
  ...ids: readonly (string | false | null | undefined)[]
): string | undefined {
  const present = ids.filter((id): id is string => typeof id === 'string' && id !== '');
  return present.length === 0 ? undefined : present.join(' ');
}

export type PasswordProblem = 'too_short' | 'too_long';

/** Client-side check of a new password with the contracts rule (the server checks again). */
export function newPasswordProblem(value: string): PasswordProblem | null {
  // UTF-16 length, exactly as the contracts schema measures it.
  const length = value.length;
  if (length < LIMITS.password.min) {
    return 'too_short';
  }
  if (length > LIMITS.password.max) {
    return 'too_long';
  }
  return null;
}

export function passwordProblemMessage(problem: PasswordProblem): string {
  return problem === 'too_short'
    ? `Şifren en az ${LIMITS.password.min} karakter olmalı.`
    : `Şifren en fazla ${LIMITS.password.max} karakter olabilir.`;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Light shape check before a request; the server validates with the contracts schema. */
export function emailProblem(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return 'E-posta adresini yaz.';
  }
  if (trimmed.length > LIMITS.email.max || !EMAIL_SHAPE.test(trimmed)) {
    return 'Geçerli bir e-posta adresi yaz.';
  }
  return null;
}

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#RRGGBB` color. */
export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match === null) {
    throw new RangeError(`not a #RRGGBB color: ${hex}`);
  }
  const [r, g, b] = [match[1], match[2], match[3]].map((part) =>
    channel(parseInt(part ?? '0', 16)),
  );
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/** WCAG contrast ratio between two `#RRGGBB` colors (1 to 21). */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}
