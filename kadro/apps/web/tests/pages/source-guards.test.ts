import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Static guards over the page sources (ADR-0040, threat model T-WEB-01/02): the token never
 * reaches browser storage or a URL, client code reads no configuration, pages render no inline
 * script, and navigation targets are constants.
 */

const APP_DIR = fileURLToPath(new URL('../../', import.meta.url));
const ROOTS = ['components/auth', 'lib/client', 'app/(app)'];

/** Code only: block and line comments are removed so prose about a rule does not trip it. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function sources(): { readonly path: string; readonly text: string }[] {
  const files: { path: string; text: string }[] = [];
  const walk = (relative: string) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed roots inside this package
    for (const entry of readdirSync(join(APP_DIR, relative), { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(child);
      } else if (/\.(ts|tsx|css)$/.test(entry.name)) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- listed above
        const text = readFileSync(join(APP_DIR, child), 'utf8');
        files.push({ path: child, text: withoutComments(text) });
      }
    }
  };
  for (const root of ROOTS) {
    walk(root);
  }
  return files;
}

const FILES = sources();

function file(path: string): string {
  const found = FILES.find((entry) => entry.path === path);
  expect(found, path).toBeDefined();
  return found?.text ?? '';
}

describe('page source guards', () => {
  it('finds the page sources', () => {
    expect(FILES.length).toBeGreaterThan(15);
  });

  it('never touches browser storage or writes cookies', () => {
    const forbidden =
      /\b(localStorage|sessionStorage|indexedDB|caches\.|openDatabase)\b|\.cookie\s*=(?!=)|cookieStore/;
    for (const { path, text } of FILES) {
      expect(forbidden.exec(text)?.[0], path).toBeUndefined();
    }
  });

  it('reads document.cookie only for the CSRF header of the deletion form', () => {
    const readers = FILES.filter(({ text }) => text.includes('document.cookie')).map(
      ({ path }) => path,
    );
    expect(readers).toEqual(['components/auth/delete-account.tsx']);
  });

  it('reads no configuration, injects no HTML and renders no script', () => {
    for (const { path, text } of FILES) {
      expect(text, path).not.toMatch(
        /process\.env|dangerouslySetInnerHTML|<script\b|next\/script|eval\(/,
      );
    }
  });

  it('navigates only to constants (no location writes, router only with the fixed target)', () => {
    for (const { path, text } of FILES) {
      expect(text, path).not.toMatch(/location\.(href\s*=|assign|replace)|window\.open\(/);
    }
    const routerCalls = FILES.flatMap(({ text }) => [
      ...text.matchAll(/router\.(push|replace)\(([^)]*)\)/g),
    ]);
    expect(routerCalls.map((match) => match[2])).toEqual(['next']);
  });

  it('captures the fragment at module evaluation and strips it with replaceState', () => {
    const capture = file('lib/client/token-capture.ts');
    expect(capture).toMatch(
      /export const pageTokenCapture: TokenCapture = createTokenCapture\(\s*typeof window === 'undefined' \? undefined : window,\s*\);/,
    );
    // Next.js runs instrumentation-client.ts before hydration and before the router reads the URL.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path inside this package
    const entry = readFileSync(join(APP_DIR, 'instrumentation-client.ts'), 'utf8');
    expect(withoutComments(entry).trim()).toBe("import './lib/client/token-capture';");
    expect(file('lib/client/fragment-token.ts')).toContain(
      "history.replaceState(null, '', location.pathname)",
    );
    for (const page of ['components/auth/verify-email.tsx', 'components/auth/reset-password.tsx']) {
      const text = file(page);
      expect(text, page).toContain("from '../../lib/client/token-capture'");
      // Only the token the request carried is dropped, never a newer one from a second link.
      expect(text, page).toContain('pageTokenCapture.forget(captured.version)');
      // Requests carrying the token are cancelled when it is released (pagehide, unmount).
      expect(text, page).toContain('captured.signal');
      expect(text, page).not.toMatch(/URLSearchParams|searchParams|useState\([^)]*token/i);
    }
  });

  it('keeps the token pages free of third-party resources', () => {
    for (const { path, text } of FILES) {
      expect(text, path).not.toMatch(/https?:\/\/(?!kadro\.)/);
    }
  });

  it('has no work markers', () => {
    for (const { path, text } of FILES) {
      expect(text, path).not.toMatch(/\b(TODO|FIXME|XXX)\b/);
    }
  });
});
