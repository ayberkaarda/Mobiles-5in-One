// Builds libs/ui/src/styles/tokens.css from brand/tokens.json: brand colour variables,
// the Ionic colour variables (base, rgb, contrast, shade, tint) and the typography variables.
// Node only, no dependencies.
// Usage: node brand/scripts/build-tokens.mjs          writes the stylesheet
//        node brand/scripts/build-tokens.mjs --check  exits 1 when the stylesheet is stale
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tokensPath = join(root, 'brand', 'tokens.json');
const cssPath = join(root, 'libs', 'ui', 'src', 'styles', 'tokens.css');
const HEX6 = /^#[0-9A-F]{6}$/;

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgbToHex = (rgb) =>
  '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0').toUpperCase()).join('');
const mix = (hex, target, amount) => {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  return rgbToHex(a.map((c, i) => c + (b[i] - c) * amount));
};
const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrastRatio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

export function buildCss(tokens) {
  const palette = tokens.color.palette;
  const errors = [];
  for (const [key, entry] of Object.entries(palette)) {
    if (!HEX6.test(entry.value)) errors.push(`palette.${key} must be an upper-case #RRGGBB value`);
  }
  const ref = (key, where) => {
    if (!palette[key]) {
      errors.push(`${where} refers to unknown palette entry "${key}"`);
      return '#000000';
    }
    return palette[key].value;
  };
  const textOnLight = ref(tokens.color.surface.text, 'surface.text');
  const textOnDark = ref(tokens.color.surface.background, 'surface.background');
  const lines = [
    '/* Built from brand/tokens.json by brand/scripts/build-tokens.mjs. Do not edit by hand. */',
    ':root {',
  ];
  for (const [key, entry] of Object.entries(palette)) {
    lines.push(`  --iv-color-${kebab(key)}: ${entry.value};`);
  }
  const legacy = tokens.color.legacy?.values ?? {};
  if (Object.keys(legacy).length > 0) {
    lines.push('  /* Former palette names, kept for pages not yet on the semantic tokens. */');
  }
  for (const [key, value] of Object.entries(legacy)) {
    if (!HEX6.test(value)) errors.push(`legacy.${key} must be an upper-case #RRGGBB value`);
    if (palette[key]) errors.push(`legacy.${key} clashes with a palette entry`);
    lines.push(`  --iv-color-${kebab(key)}: ${value};`);
  }
  lines.push(`  --iv-color-background: ${textOnDark};`);
  lines.push(`  --iv-color-text: ${textOnLight};`);
  for (const [name, key] of Object.entries(tokens.color.ionic)) {
    const base = ref(key, `ionic.${name}`);
    // Contrast colour: whichever of the brand text colours reads better on the base colour.
    const contrast =
      contrastRatio(base, textOnLight) >= contrastRatio(base, '#FFFFFF') ? textOnLight : '#FFFFFF';
    const prefix = `  --ion-color-${name}`;
    lines.push(`${prefix}: ${base};`);
    lines.push(`${prefix}-rgb: ${hexToRgb(base).join(', ')};`);
    lines.push(`${prefix}-contrast: ${contrast};`);
    lines.push(`${prefix}-contrast-rgb: ${hexToRgb(contrast).join(', ')};`);
    lines.push(`${prefix}-shade: ${mix(base, '#000000', 0.12)};`);
    lines.push(`${prefix}-tint: ${mix(base, '#FFFFFF', 0.1)};`);
  }
  lines.push(`  --ion-background-color: ${textOnDark};`);
  lines.push(`  --ion-background-color-rgb: ${hexToRgb(textOnDark).join(', ')};`);
  lines.push(`  --ion-text-color: ${textOnLight};`);
  lines.push(`  --ion-text-color-rgb: ${hexToRgb(textOnLight).join(', ')};`);
  const { display, body, fare } = tokens.typography;
  lines.push(`  --iv-font-display: '${display.family}', ${display.fallback};`);
  lines.push(`  --iv-font-display-weight: ${display.weights[0]};`);
  lines.push(`  --iv-font-body: '${body.family}', ${body.fallback};`);
  body.weights.forEach((w) => lines.push(`  --iv-font-body-weight-${w}: ${w};`));
  lines.push(`  --iv-font-fare-numeric: ${fare.fontVariantNumeric};`);
  lines.push(`  --ion-font-family: var(--iv-font-body);`);
  lines.push('}', '');
  return { css: lines.join('\n'), errors };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const tokens = JSON.parse(readFileSync(tokensPath, 'utf8'));
  const { css, errors } = buildCss(tokens);
  if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  if (process.argv.includes('--check')) {
    const current = existsSync(cssPath) ? readFileSync(cssPath, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== css) {
      console.error(
        'libs/ui/src/styles/tokens.css is stale: run node brand/scripts/build-tokens.mjs',
      );
      process.exit(1);
    }
    console.log('libs/ui/src/styles/tokens.css matches brand/tokens.json');
  } else {
    writeFileSync(cssPath, css);
    console.log('wrote libs/ui/src/styles/tokens.css');
  }
}
