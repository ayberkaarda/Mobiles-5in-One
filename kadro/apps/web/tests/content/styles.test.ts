import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const THEME = readFileSync(resolve(ROOT, '../../packages/brand/theme/theme.css'), 'utf8');
const SHEETS = ['prose.module.css', 'invite.module.css'] as const;

function defined(): ReadonlySet<string> {
  return new Set([...THEME.matchAll(/(--k-[a-z0-9-]+)\s*:/g)].map((match) => match[1] ?? ''));
}

describe('content stylesheets', () => {
  for (const name of SHEETS) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed sheet names of this package
    const css = readFileSync(resolve(ROOT, 'components/content', name), 'utf8');

    it(`${name} uses only brand properties, no legacy aliases or literal colours`, () => {
      expect(css).not.toMatch(/--m-/);
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css).not.toMatch(/\b(rgb|hsl)a?\(/);
      const known = defined();
      for (const match of css.matchAll(/var\((--k-[a-z0-9-]+)/g)) {
        expect(known.has(match[1] ?? ''), match[1]).toBe(true);
      }
    });

    it(`${name} keeps focus rings visible`, () => {
      expect(css).not.toMatch(/outline:\s*(none|0)/);
    });
  }
});
