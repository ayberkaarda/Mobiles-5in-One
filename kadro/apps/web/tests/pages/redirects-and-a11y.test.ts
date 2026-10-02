import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { LIMITS } from '@kadro/contracts';
import { describe, expect, it } from 'vitest';

import {
  BUTTON_TARGET_PX,
  contrastRatio,
  describedBy,
  emailProblem,
  MIN_CONTRAST,
  MIN_TARGET_PX,
  newPasswordProblem,
  passwordProblemMessage,
} from '../../lib/client/a11y';
import { formatGraceUntil, graceUntilFrom, readCookieValue } from '../../lib/client/cookies';
import { AFTER_LOGIN_TARGETS, afterLoginTarget, PAGE_PATHS } from '../../lib/client/redirects';
import { NON_TEXT_PAIRS, TEXT_PAIRS, THEME, themeVariables } from '../../lib/client/theme';
import { freshToken } from './support';

const TOKENS_FILE = fileURLToPath(
  new URL('../../../../packages/brand/tokens.json', import.meta.url),
);
const CSS_FILE = fileURLToPath(new URL('../../components/auth/auth.module.css', import.meta.url));

describe('afterLoginTarget (no open redirect)', () => {
  it('accepts exactly the fixed targets', () => {
    expect(AFTER_LOGIN_TARGETS).toEqual(['/', '/hesap-silme']);
    expect(afterLoginTarget('/hesap-silme')).toBe('/hesap-silme');
    expect(afterLoginTarget('/')).toBe('/');
  });

  it('falls back to / for everything else', () => {
    const hostile: unknown[] = [
      undefined,
      null,
      '',
      ['/hesap-silme'],
      ['/hesap-silme', '/'],
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      'javascript:alert(1)',
      'data:text/html,x',
      '/hesap-silme?x=1',
      '/hesap-silme#token=x',
      '/hesap-silme/',
      '/HESAP-SILME',
      '%2Fhesap-silme',
      '/%2F%2Fevil.example',
      ' /hesap-silme',
      '/hesap-silme\n',
      '/giris',
      '/sifre-sifirla',
      { toString: () => '/hesap-silme' },
    ];
    for (const candidate of hostile) {
      expect(afterLoginTarget(candidate), JSON.stringify(candidate) ?? String(candidate)).toBe('/');
    }
  });

  it('lists the five page paths of ADR-0040', () => {
    expect(Object.values(PAGE_PATHS).filter((path) => path !== '/')).toEqual([
      '/e-posta-dogrula',
      '/sifre-sifirla',
      '/sifremi-unuttum',
      '/giris',
      '/hesap-silme',
    ]);
  });
});

describe('form helpers', () => {
  it('applies the contracts password rule', () => {
    expect(newPasswordProblem('a'.repeat(LIMITS.password.min - 1))).toBe('too_short');
    expect(newPasswordProblem('a'.repeat(LIMITS.password.min))).toBeNull();
    expect(newPasswordProblem('a'.repeat(LIMITS.password.max))).toBeNull();
    expect(newPasswordProblem('a'.repeat(LIMITS.password.max + 1))).toBe('too_long');
    expect(passwordProblemMessage('too_short')).toContain(String(LIMITS.password.min));
    expect(passwordProblemMessage('too_long')).toContain(String(LIMITS.password.max));
  });

  it('checks the email shape', () => {
    expect(emailProblem('')).toBe('E-posta adresini yaz.');
    expect(emailProblem('   ')).toBe('E-posta adresini yaz.');
    expect(emailProblem('ad')).toBe('Geçerli bir e-posta adresi yaz.');
    expect(emailProblem(`${'a'.repeat(250)}@b.co`)).toBe('Geçerli bir e-posta adresi yaz.');
    expect(emailProblem(' oyuncu@kadro.app ')).toBeNull();
  });

  it('joins aria-describedby ids', () => {
    expect(describedBy('a', false, null, undefined, '', 'b')).toBe('a b');
    expect(describedBy(false, null)).toBeUndefined();
  });

  it('reads the CSRF cookie and refuses tossed or odd values', () => {
    const value = freshToken();
    expect(readCookieValue(`a=1; __Host-kadro_csrf=${value}; b=2`, '__Host-kadro_csrf')).toBe(
      value,
    );
    expect(
      readCookieValue(`__Host-kadro_csrf=${value}; __Host-kadro_csrf=x`, '__Host-kadro_csrf'),
    ).toBeNull();
    expect(readCookieValue('__Host-kadro_csrf=a b', '__Host-kadro_csrf')).toBeNull();
    expect(readCookieValue('', '__Host-kadro_csrf')).toBeNull();
  });

  it('formats the deletion date in Turkish, Istanbul time', () => {
    expect(formatGraceUntil('2026-10-08T18:30:00Z')).toBe('8 Ekim 2026 21:30');
    expect(formatGraceUntil('nope')).toBeNull();
    expect(graceUntilFrom({ graceUntil: '2026-10-08T18:30:00Z' })).toBe('8 Ekim 2026 21:30');
    expect(graceUntilFrom(null)).toBeNull();
    expect(graceUntilFrom({ graceUntil: 5 })).toBeNull();
  });
});

describe('theme and contrast (WCAG 1.4.3, 1.4.11)', () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path in the repository
  const tokens = JSON.parse(readFileSync(TOKENS_FILE, 'utf8')) as {
    color: { theme: { light: Record<string, string> } };
    contrast: { minimumRatio: number };
  };

  it('uses the brand token values', () => {
    for (const [name, value] of Object.entries(THEME)) {
      expect(tokens.color.theme.light[name], name).toBe(value);
    }
    expect(tokens.contrast.minimumRatio).toBe(MIN_CONTRAST);
  });

  it('keeps every text pair at 4.5:1 or more', () => {
    for (const [foreground, background] of TEXT_PAIRS) {
      const ratio = contrastRatio(THEME[foreground], THEME[background]);
      expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it('keeps focus ring and borders at 3:1 or more', () => {
    for (const [foreground, background] of NON_TEXT_PAIRS) {
      expect(contrastRatio(THEME[foreground], THEME[background])).toBeGreaterThanOrEqual(3);
    }
  });

  it('computes known ratios', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(() => contrastRatio('red', '#FFFFFF')).toThrow(RangeError);
  });

  it('exposes every color as a custom property', () => {
    expect(themeVariables()).toMatchObject({ '--k-text': THEME.text, '--k-danger': THEME.danger });
  });
});

describe('stylesheet', () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path in this package
  const css = readFileSync(CSS_FILE, 'utf8');

  function block(selector: string): string {
    const start = css.indexOf(`\n${selector} {`);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf('}', start));
  }

  it('gives buttons, inputs and the toggle 44 px targets and checkboxes 24 px', () => {
    expect(BUTTON_TARGET_PX).toBeGreaterThanOrEqual(MIN_TARGET_PX);
    for (const selector of ['.input', '.toggle', '.brand']) {
      expect(block(selector)).toContain(`min-height: ${BUTTON_TARGET_PX}px`);
    }
    expect(css).toMatch(/\.button,\n\.buttonLink \{[^}]*min-height: 44px/);
    expect(block('.checkbox')).toContain(`width: ${MIN_TARGET_PX}px`);
    expect(block('.checkbox')).toContain(`height: ${MIN_TARGET_PX}px`);
    expect(block('.link')).toContain(`min-height: ${MIN_TARGET_PX}px`);
  });

  it('shows focus on every interactive element', () => {
    for (const selector of [
      '.input',
      '.toggle',
      '.button',
      '.buttonLink',
      '.link',
      '.checkbox',
      '.brand',
    ]) {
      expect(css).toContain(`${selector}:focus-visible`);
    }
    expect(css).toMatch(/:focus-visible \{\s*outline: 3px solid var\(--k-text\)/);
    expect(css).not.toMatch(/outline:\s*(none|0)/);
  });

  it('honours reduced motion and uses only theme colors', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[^@]*transition: none/);
    const colors = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(colors).toEqual([]);
  });
});
