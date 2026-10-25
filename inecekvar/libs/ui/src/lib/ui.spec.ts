import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FarePipe } from './fare.pipe';

const workspaceRoot = join(__dirname, '..', '..', '..', '..');
const tokens = JSON.parse(readFileSync(join(workspaceRoot, 'brand', 'tokens.json'), 'utf8')) as {
  color: { palette: Record<string, { value: string }>; ionic: Record<string, string> };
};
const css = readFileSync(join(workspaceRoot, 'libs', 'ui', 'src', 'styles', 'tokens.css'), 'utf8');

describe('tokens.css', () => {
  it('carries every brand palette colour', () => {
    for (const { value } of Object.values(tokens.color.palette)) {
      expect(css).toContain(value);
    }
  });

  it('maps every Ionic colour to its palette entry', () => {
    for (const [name, key] of Object.entries(tokens.color.ionic)) {
      expect(css).toContain(`--ion-color-${name}: ${tokens.color.palette[key]?.value};`);
    }
  });
});

describe('FarePipe', () => {
  it('formats kuruş through the domain formatter', () => {
    expect(new FarePipe().transform(1500).replace(/\s/g, '')).toBe('₺15,00');
  });

  it('formats the same lira amount in the English locale and keeps the range check', () => {
    expect(new FarePipe().transform(125050, 'en-GB')).toBe('₺1,250.50');
    expect(new FarePipe().transform(125050).replace(/\s/g, '')).toBe('₺1.250,50');
    expect(() => new FarePipe().transform(-1, 'en-GB')).toThrow(RangeError);
  });
});

describe('theme.css and fonts', () => {
  const styles = join(workspaceRoot, 'libs', 'ui', 'src', 'styles');
  const theme = readFileSync(join(styles, 'theme.css'), 'utf8');
  const fonts = readFileSync(join(styles, '_fonts.scss'), 'utf8');

  it('uses the night-line signal as the primary in dark mode', () => {
    const dark = theme.slice(theme.indexOf(':root.ion-palette-dark'));
    expect(dark.toLowerCase()).toContain(
      `--ion-color-primary: ${tokens.color.palette['sodyumTuruncusu']?.value.toLowerCase()};`,
    );
  });

  it('self-hosts every brand weight with the Turkish (latin-ext) subset', () => {
    expect(fonts).toContain("@use '@fontsource/dm-sans/latin-ext-700.css';");
    for (const weight of [400, 500, 600]) {
      expect(fonts).toContain(`@use '@fontsource/inter/latin-ext-${weight}.css';`);
    }
    expect(fonts).not.toMatch(/https?:\/\//);
  });
});

describe('semantic tokens', () => {
  const semantic = readFileSync(
    join(workspaceRoot, 'libs', 'ui', 'src', 'styles', '_semantic.scss'),
    'utf8',
  );
  const block = (name: string): Record<string, string> => {
    const start = semantic.indexOf(`@mixin ${name} {`);
    const body = semantic.slice(start, semantic.indexOf('\n}', start));
    const values: Record<string, string> = {};
    for (const [, key, value] of body.matchAll(/--iv-([a-z-]+):\s*(#[0-9a-f]{6});/gi)) {
      values[key] = value;
    }
    return values;
  };
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  // Text and the ground it sits on; every pair must reach WCAG AA for body text.
  const pairs: [string, string][] = [
    ['ink', 'bg'],
    ['ink', 'surface'],
    ['ink', 'surface-sunk'],
    ['ink-muted', 'bg'],
    ['ink-muted', 'surface'],
    ['ink-muted', 'surface-sunk'],
    ['board-ink', 'board'],
    ['board-muted', 'board'],
    ['board-sign', 'board'],
    ['board-ink', 'board-raised'],
    ['plate-ink', 'plate'],
    ['accent-ink', 'accent'],
    ['signal-ink', 'signal'],
    ['danger-ink', 'danger'],
    ['danger', 'surface'],
    ['danger', 'bg'],
    ['success', 'surface'],
    ['success', 'bg'],
    ['info', 'surface'],
    ['info', 'bg'],
    ['chrome-ink', 'chrome'],
    ['chrome-ink-muted', 'chrome'],
    ['tabbar-ink', 'tabbar'],
    ['tabbar-ink-muted', 'tabbar'],
    ['tag-ink', 'tag'],
    ['ticket-ink', 'ticket'],
  ];

  for (const scheme of ['light', 'dark']) {
    it(`keeps every ${scheme} text pair at 4.5:1 or more`, () => {
      const tokens = block(scheme);
      const failures = pairs
        .map(([fg, bg]) => [fg, bg, contrast(tokens[fg], tokens[bg])] as const)
        .filter(([, , ratio]) => !(ratio >= 4.5));
      expect(failures).toEqual([]);
    });
  }

  it('writes errors in the light scheme as charcoal, not red', () => {
    expect(block('light')['danger']).toBe(block('light')['ink']);
  });
});
