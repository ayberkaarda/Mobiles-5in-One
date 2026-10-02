import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(readFileSync(join(root, 'tokens.json'), 'utf8'));
const errors = [];
const HEX = /^#[0-9A-Fa-f]{6}$/;

const spec = {
  pitchGreen: '#1B7F4B',
  nightMatch: '#0E1A14',
  chalkWhite: '#F4F6F0',
  orangeBall: '#FF6B1A',
  cardYellow: '#F2C230',
  redCard: '#D7263D',
  neutral: '#5B6B62',
};
for (const [k, v] of Object.entries(spec)) {
  if (tokens.color.palette[k]?.toUpperCase() !== v) errors.push(`palette.${k} must be ${v}`);
}

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

for (const [name, v] of Object.entries(tokens.color.palette)) {
  if (!HEX.test(v)) errors.push(`palette.${name} is not a 6-digit hex`);
}
for (const [theme, values] of Object.entries(tokens.color.theme)) {
  for (const [name, v] of Object.entries(values)) {
    if (!HEX.test(v)) errors.push(`theme.${theme}.${name} is not a 6-digit hex`);
  }
}

const min = tokens.contrast.minimumRatio;
for (const p of tokens.contrast.pairs) {
  const t = tokens.color.theme[p.theme];
  const fg = t?.[p.foreground];
  const bg = t?.[p.background];
  if (!fg || !bg) {
    errors.push(`unknown contrast pair ${JSON.stringify(p)}`);
    continue;
  }
  const r = ratio(fg, bg);
  const line = `${p.theme}: ${p.foreground} ${fg} on ${p.background} ${bg} = ${r.toFixed(2)}`;
  if (r < min) errors.push(`${line} (< ${min})`);
  else console.log(`ok   ${line}`);
}

for (const [name, v] of Object.entries(tokens.spacing)) {
  if (v % 4 !== 0) errors.push(`spacing.${name}=${v} is off the 4-pt grid`);
}
const radii = [tokens.radius.sm, tokens.radius.md, tokens.radius.lg].join('/');
if (radii !== '8/12/20') errors.push(`radius must be 8/12/20, got ${radii}`);

for (const [name, s] of Object.entries(tokens.typography.scale)) {
  if (!tokens.typography.fontFamily[s.family]) errors.push(`type.${name}: unknown family`);
  if (s.lineHeight < s.size) errors.push(`type.${name}: lineHeight < size`);
}

const assets = [
  'logo/kadro-wordmark.svg',
  'logo/kadro-wordmark-light.svg',
  'logo/kadro-wordmark-mono.svg',
  'logo/kadro-mark.svg',
  'logo/kadro-app-icon.svg',
  'logo/kadro-app-icon-rounded.svg',
  'logo/kadro-icon-foreground.svg',
  'fonts/sora/Sora-VariableFont_wght.ttf',
  'fonts/sora/OFL.txt',
  'fonts/inter/Inter-VariableFont.ttf',
  'fonts/inter/OFL.txt',
];
for (const a of assets) if (!existsSync(join(root, a))) errors.push(`missing asset ${a}`);
for (const f of readdirSync(join(root, 'logo')).filter((n) => n.endsWith('.svg'))) {
  const s = readFileSync(join(root, 'logo', f), 'utf8');
  if (!s.startsWith('<svg') || !s.trimEnd().endsWith('</svg>') || !s.includes('viewBox')) {
    errors.push(`logo/${f} is not a well-formed standalone svg`);
  }
}

if (errors.length) {
  console.error(errors.map((e) => `FAIL ${e}`).join('\n'));
  process.exit(1);
}
console.log('brand tokens and assets valid');
