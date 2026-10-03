import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Root layout (ADR-0084): `<html data-theme>` comes from the `kadro-theme` cookie on the server,
 * so the first paint is in the stored scheme with no inline script; `color-scheme` and one
 * `theme-color` per scheme complete it.
 */

const jar = vi.hoisted(() => ({ value: undefined as string | undefined, names: [] as string[] }));

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        jar.names.push(name);
        return jar.value === undefined ? undefined : { name, value: jar.value };
      },
    }),
}));

const { default: RootLayout, viewport } = await import('../../app/layout');

async function htmlTag(cookie: string | undefined): Promise<string> {
  jar.value = cookie;
  const element = await RootLayout({ children: <p>İçerik</p> });
  const html = renderToStaticMarkup(element);
  return /<html\b[^>]*>/.exec(html)?.[0] ?? '';
}

beforeEach(() => {
  jar.value = undefined;
  jar.names = [];
});

describe('root layout colour scheme', () => {
  it('renders data-theme="system" without a cookie and reads only the theme cookie', async () => {
    expect(await htmlTag(undefined)).toBe('<html lang="tr" data-theme="system">');
    expect(jar.names).toEqual(['kadro-theme']);
  });

  it('renders the stored preference', async () => {
    for (const preference of ['system', 'light', 'dark']) {
      expect(await htmlTag(preference)).toBe(`<html lang="tr" data-theme="${preference}">`);
    }
  });

  it('falls back to system for an unknown or hostile cookie value', async () => {
    for (const value of ['sepia', 'DARK', '', 'dark" onload="x', '<script>']) {
      expect(await htmlTag(value)).toBe('<html lang="tr" data-theme="system">');
    }
  });

  it('renders no inline script and no style attribute', async () => {
    jar.value = 'dark';
    const html = renderToStaticMarkup(await RootLayout({ children: <p>İçerik</p> }));
    expect(html).not.toMatch(/<script\b|style=/);
  });

  it('declares both schemes and one theme colour per scheme', () => {
    expect(viewport.colorScheme).toBe('light dark');
    expect(viewport.themeColor).toEqual([
      { media: '(prefers-color-scheme: light)', color: '#F5F6F1' },
      { media: '(prefers-color-scheme: dark)', color: '#0C1611' },
    ]);
  });
});
