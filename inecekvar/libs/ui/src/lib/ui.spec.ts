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
});

describe('theme.css and fonts', () => {
  const styles = join(workspaceRoot, 'libs', 'ui', 'src', 'styles');
  const theme = readFileSync(join(styles, 'theme.css'), 'utf8');
  const fonts = readFileSync(join(styles, '_fonts.scss'), 'utf8');

  it('keeps the brand primary in dark mode', () => {
    const dark = theme.slice(theme.indexOf(':root.ion-palette-dark'));
    expect(dark.toLowerCase()).toContain(
      `--ion-color-primary: ${tokens.color.palette['dolmusSarisi']?.value.toLowerCase()};`,
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
