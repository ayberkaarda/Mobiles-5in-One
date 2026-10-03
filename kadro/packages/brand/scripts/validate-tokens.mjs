// Checks the brand package: the design tokens of both colour schemes (theme/tokens.json), the
// WCAG contrast of every listed pair in light and dark, the type scale against the shipped font
// instances, the font files themselves (Turkish glyphs, features, axes) and the logo files. The
// frozen v1 file (tokens.json) is checked too while the apps still read it.
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename -- offline build-time script: every key comes from this package's own token file and every path stays inside the package. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectFont } from './font-tables.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(root, file));
const readJson = (file) => JSON.parse(read(file).toString('utf8'));
const exists = (file) => existsSync(join(root, file));

const errors = [];
const out = [];
const fail = (message) => errors.push(message);
const HEX = /^#[0-9A-F]{6}$/;
const RGBA = /^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d+)\)$/;

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrastRatio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const hexName = (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

const tokens = readJson('theme/tokens.json');
const { palette, theme, fixedRoles, overlay } = tokens.color;
const SCHEMES = tokens.theming.schemes;

// 1. Palette: the identity hues stay; every value is upper-case 6-digit hex.
const identity = {
  pitchGreen: '#1B7F4B',
  turfDeep: '#0E5B36',
  nightMatch: '#0C1611',
  chalkWhite: '#F5F6F1',
  ink: '#0F1A14',
  orangeBall: '#FF6B1A',
  cardYellow: '#F2C230',
  redCard: '#D7263D',
};
for (const [name, value] of Object.entries(identity)) {
  if (palette[name] !== value) fail(`palette.${name} must be ${value}`);
}
const paletteValues = new Set(Object.values(palette));
for (const [name, value] of Object.entries(palette)) {
  if (!HEX.test(value)) fail(`palette.${name} is not an upper-case 6-digit hex`);
}

// 2. Schemes: same roles, values from the palette (no new hue), fixed roles equal.
const roleNames = Object.keys(theme.light);
if (SCHEMES.join() !== 'light,dark') fail('theming.schemes must be light, dark');
for (const scheme of SCHEMES) {
  const roles = theme[scheme];
  if (!roles) {
    fail(`missing color.theme.${scheme}`);
    continue;
  }
  if (Object.keys(roles).join() !== roleNames.join()) {
    fail(`color.theme.${scheme} must list the same roles in the same order as light`);
  }
  for (const [role, value] of Object.entries(roles)) {
    if (!HEX.test(value)) fail(`theme.${scheme}.${role} is not an upper-case 6-digit hex`);
    else if (!paletteValues.has(value)) {
      fail(`theme.${scheme}.${role} ${value} is not in the palette`);
    }
  }
  const overlays = overlay[scheme] ?? {};
  if (Object.keys(overlays).join() !== 'pressed,scrim') {
    fail(`overlay.${scheme} must be pressed, scrim`);
  }
  for (const [name, value] of Object.entries(overlays)) {
    if (!RGBA.test(value)) fail(`overlay.${scheme}.${name} is not rgba(r, g, b, a)`);
  }
}
for (const role of fixedRoles) {
  if (!roleNames.includes(role)) fail(`fixed role ${role} is not a colour role`);
  else if (theme.light[role] !== theme.dark[role]) {
    fail(`fixed role ${role} differs between schemes`);
  }
}

// 3. Contrast in both schemes: text pairs at 4.5:1, non-text pairs at 3:1.
const expand = (pairs) =>
  pairs.flatMap((pair) =>
    (pair.scheme === 'both' ? SCHEMES : [pair.scheme]).map((scheme) => ({ ...pair, scheme })),
  );
const checked = { text: { light: 0, dark: 0 }, nonText: { light: 0, dark: 0 } };
const lowest = {};
function checkPairs(kind, pairs, minimum) {
  for (const pair of expand(pairs)) {
    const roles = theme[pair.scheme];
    const fg = roles?.[pair.foreground];
    const bg = roles?.[pair.background];
    if (!fg || !bg) {
      fail(`unknown ${kind} pair ${JSON.stringify(pair)}`);
      continue;
    }
    const ratio = contrastRatio(fg, bg);
    const line = `${pair.scheme} ${pair.foreground} ${fg} on ${pair.background} ${bg} = ${ratio.toFixed(2)}`;
    checked[kind][pair.scheme] += 1;
    const slot = `${kind}.${pair.scheme}`;
    if (!lowest[slot] || ratio < lowest[slot].ratio) lowest[slot] = { ratio, line };
    if (ratio < minimum) fail(`${kind} ${line} (< ${minimum})`);
    else out.push(`ok   ${kind} ${line}`);
  }
}
if (tokens.contrast.minimumRatio < 4.5) fail('contrast.minimumRatio must be at least 4.5');
if (tokens.contrast.nonTextMinimumRatio < 3)
  fail('contrast.nonTextMinimumRatio must be at least 3');
checkPairs('text', tokens.contrast.pairs, tokens.contrast.minimumRatio);
checkPairs('nonText', tokens.contrast.nonTextPairs, tokens.contrast.nonTextMinimumRatio);

// Every role that carries meaning is covered in both schemes.
const mustCover = {
  text: [
    'text',
    'textMuted',
    'primaryText',
    'link',
    'dangerText',
    'accentText',
    'onInverse',
    'onPrimary',
    'onAccent',
    'onWarning',
    'onDanger',
    'pitchLine',
    'onPitch',
    'onPitchMarker',
  ],
  nonText: ['borderStrong', 'focusRing', 'primary', 'accent', 'danger', 'pitchMarker'],
};
for (const [kind, roles] of Object.entries(mustCover)) {
  const pairs = expand(kind === 'text' ? tokens.contrast.pairs : tokens.contrast.nonTextPairs);
  for (const scheme of SCHEMES) {
    for (const role of roles) {
      if (!pairs.some((p) => p.scheme === scheme && p.foreground === role)) {
        fail(`${kind} pairs do not cover ${role} in ${scheme}`);
      }
    }
  }
}

// 4. State and theming references.
const ROLE_FIELDS = new Set(['fill', 'on', 'text', 'outline', 'color']);
const walkRoles = (value, path) => {
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walkRoles(v, `${path}.${k}`);
    return;
  }
  const field = path.split('.').pop();
  if (ROLE_FIELDS.has(field) || path.startsWith('state.match.')) {
    if (!roleNames.includes(value)) fail(`${path} refers to unknown role ${value}`);
  }
};
walkRoles(tokens.state, 'state');
if (tokens.theming.preferences.join() !== 'system,light,dark') {
  fail('theming.preferences must be system, light, dark');
}
if (!tokens.theming.preferences.includes(tokens.theming.defaultPreference)) {
  fail('theming.defaultPreference must be one of the preferences');
}
for (const scheme of SCHEMES) {
  if (tokens.theming.web.themeColor[scheme] !== theme[scheme].background) {
    fail(`theming.web.themeColor.${scheme} must equal the ${scheme} background`);
  }
}

// 5. Spacing, radius, type.
for (const [name, v] of Object.entries(tokens.spacing)) {
  if (v % 4 !== 0) fail(`spacing.${name}=${v} is off the 4-pt grid`);
}
const radii = ['xs', 'sm', 'md', 'lg'].map((n) => tokens.radius[n]).join('/');
if (radii !== '4/8/12/20') fail(`radius must be 4/8/12/20, got ${radii}`);
for (const [use, name] of Object.entries(tokens.radius.usage)) {
  if (typeof tokens.radius[name] !== 'number')
    fail(`radius.usage.${use} refers to unknown ${name}`);
}

const t = tokens.typography;
for (const [scaleName, scale] of [
  ['scale', t.scale],
  ['scaleMobile', t.scaleMobile],
]) {
  for (const [name, s] of Object.entries(scale)) {
    const where = `typography.${scaleName}.${name}`;
    if (!t.fontFamily[s.family]) fail(`${where}: unknown family ${s.family}`);
    if (s.lineHeight < s.size) fail(`${where}: lineHeight < size`);
    const instance = t.nativeFamily[s.family]?.[String(s.weight)];
    const file = instance && t.fontFiles.static[instance];
    if (!file) fail(`${where}: no static instance for ${s.family} ${s.weight}`);
    else if (file.wdth !== t.fontWidth[s.family] || file.wght !== s.weight) {
      fail(`${where}: ${instance} is wdth ${file.wdth} wght ${file.wght}`);
    }
    // Narrow type only at weight 700+ and display sizes (direction §4.2).
    if (s.family !== 'body' && s.weight < 700) fail(`${where}: narrow width needs weight 700+`);
    if (s.family === 'display' && s.size < 24) fail(`${where}: narrow width below 24 px`);
  }
}
for (const name of Object.keys(t.scaleWebMobile)) {
  if (!t.scale[name]) fail(`typography.scaleWebMobile.${name} has no desktop entry`);
}

// 6. Font files.
const files = t.fontFiles;
const required = files.requiredGlyphs.map((u) => parseInt(u.slice(2), 16));
const fontReport = [];
function checkFont(file, { variable, weight, postScriptName, glyphs = required }) {
  if (!exists(file)) {
    fail(`missing font ${file}`);
    return undefined;
  }
  let font;
  try {
    font = inspectFont(read(file));
  } catch (error) {
    fail(`${file}: cannot read font tables (${error.message})`);
    return undefined;
  }
  const missing = glyphs.filter((cp) => !font.hasGlyph(cp));
  if (missing.length) fail(`${file}: missing glyphs ${missing.map(hexName).join(' ')}`);
  // Tabular figures only matter in a file that has digits (the latin-ext subset has none).
  const features = files.requiredFeatures.filter((f) => f !== 'tnum' || font.hasGlyph(0x30));
  for (const feature of features) {
    if (!font.features.includes(feature)) fail(`${file}: missing OpenType feature ${feature}`);
  }
  const axisTags = font.axes
    .map((a) => a.tag)
    .sort()
    .join();
  if (variable && axisTags !== 'wdth,wght') {
    fail(`${file}: expected wdth and wght axes, got ${axisTags || 'none'}`);
  }
  if (!variable && (font.tables.includes('fvar') || font.tables.includes('gvar'))) {
    fail(`${file}: a static instance must not carry fvar/gvar`);
  }
  if (weight && font.weightClass !== weight) {
    fail(`${file}: OS/2 weight ${font.weightClass}, expected ${weight}`);
  }
  if (postScriptName && font.postScriptName !== postScriptName) {
    fail(`${file}: PostScript name ${font.postScriptName}, expected ${postScriptName}`);
  }
  const axes = font.axes.map((a) => `${a.tag} ${a.min}-${a.max}`).join(', ') || 'static';
  fontReport.push(
    `font ${file}: Turkish glyphs ${glyphs.length - missing.length}/${glyphs.length}, ${axes}, features ${features.join(' ')}`,
  );
  return font;
}

const variableFont = checkFont(files.variable, { variable: true });
if (variableFont) {
  const ranges = Object.fromEntries(variableFont.axes.map((a) => [a.tag, a]));
  if (!(ranges.wdth?.min <= 75 && ranges.wdth?.max >= 100)) {
    fail('variable font must cover wdth 75-100');
  }
  if (!(ranges.wght?.min <= 400 && ranges.wght?.max >= 800)) {
    fail('variable font must cover wght 400-800');
  }
}
const [stretchMin, stretchMax] = files.web.fontStretch.split(' ').map((v) => parseInt(v, 10));
const [weightMin, weightMax] = files.web.fontWeight.split(' ').map(Number);
let webBytes = 0;
for (const subset of files.web.subsets) {
  // The Turkish letters and the lira sign live in the latin file: a Turkish page loads one file.
  const glyphs = subset.name === 'latin' ? required : [];
  const font = checkFont(subset.file, { variable: true, glyphs });
  if (exists(subset.file)) webBytes += statSync(join(root, subset.file)).size;
  if (!font) continue;
  const ranges = Object.fromEntries(font.axes.map((a) => [a.tag, a]));
  if (ranges.wdth?.min !== stretchMin || ranges.wdth?.max !== stretchMax) {
    fail(`${subset.file}: wdth axis must be ${files.web.fontStretch}`);
  }
  if (ranges.wght?.min !== weightMin || ranges.wght?.max !== weightMax) {
    fail(`${subset.file}: wght axis must be ${files.web.fontWeight}`);
  }
}
if (
  files.web.subsets
    .filter((s) => s.preload)
    .map((s) => s.name)
    .join() !== 'latin'
) {
  fail('only the latin subset is preloaded');
}
const webKB = (webBytes / 1024).toFixed(1);
if (webBytes > files.web.payloadBudgetKB * 1024) {
  fail(`web font subsets total ${webKB} KB > ${files.web.payloadBudgetKB} KB`);
}
fontReport.push(`web subsets total ${webKB} KB (budget ${files.web.payloadBudgetKB} KB)`);
for (const [name, spec] of Object.entries(files.static)) {
  if (!spec.file.endsWith(`/${name}.ttf`)) fail(`static instance ${name} must live in ${name}.ttf`);
  checkFont(spec.file, { variable: false, weight: spec.wght, postScriptName: name });
}
const licence = exists(files.licenceFile) ? read(files.licenceFile).toString('utf8') : '';
if (!licence.includes('SIL Open Font License, Version 1.1')) {
  fail(`${files.licenceFile} must be the SIL OFL 1.1 text`);
}

// 7. Logo files: well-formed standalone SVGs, no external content, palette colours only.
const logos = [
  'logo/kadro-wordmark.svg',
  'logo/kadro-wordmark-light.svg',
  'logo/kadro-wordmark-mono.svg',
  'logo/kadro-mark.svg',
  'logo/kadro-app-icon.svg',
  'logo/kadro-app-icon-rounded.svg',
  'logo/kadro-icon-foreground.svg',
];
for (const file of logos) if (!exists(file)) fail(`missing asset ${file}`);
for (const f of readdirSync(join(root, 'logo')).filter((n) => n.endsWith('.svg'))) {
  const s = read(`logo/${f}`).toString('utf8');
  if (!s.startsWith('<svg') || !s.trimEnd().endsWith('</svg>') || !s.includes('viewBox')) {
    fail(`logo/${f} is not a well-formed standalone svg`);
  }
  if (/<(script|image|foreignObject|style)\b|href=|url\(/i.test(s)) {
    fail(`logo/${f} references external content`);
  }
  for (const colour of s.match(/#[0-9A-Fa-f]{6}\b/g) ?? []) {
    if (!paletteValues.has(colour.toUpperCase()))
      fail(`logo/${f} uses ${colour}, not in the palette`);
  }
}

// 8. Frozen v1 tokens (tokens.json) and fonts that the apps import until they migrate.
const legacy = readJson('tokens.json');
for (const [scheme, values] of Object.entries(legacy.color.theme)) {
  for (const [name, v] of Object.entries(values)) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(v)) fail(`tokens.json theme.${scheme}.${name} is not a hex`);
  }
}
for (const p of legacy.contrast.pairs) {
  const fg = legacy.color.theme[p.theme]?.[p.foreground];
  const bg = legacy.color.theme[p.theme]?.[p.background];
  if (!fg || !bg || contrastRatio(fg, bg) < legacy.contrast.minimumRatio) {
    fail(`tokens.json pair ${JSON.stringify(p)} below ${legacy.contrast.minimumRatio}`);
  }
}
for (const file of [
  'fonts/sora/Sora-VariableFont_wght.ttf',
  'fonts/sora/OFL.txt',
  'fonts/inter/Inter-VariableFont.ttf',
  'fonts/inter/OFL.txt',
]) {
  if (!exists(file)) fail(`missing v1 asset ${file} (imported by apps/mobile until it migrates)`);
}

process.stdout.write(`${out.join('\n')}\n${fontReport.join('\n')}\n`);
for (const kind of ['text', 'nonText']) {
  for (const scheme of SCHEMES) {
    const low = lowest[`${kind}.${scheme}`];
    process.stdout.write(
      `${kind} ${scheme}: ${checked[kind][scheme]} pairs, lowest ${low ? low.line : 'n/a'}\n`,
    );
  }
}
if (errors.length) {
  process.stderr.write(`${errors.map((e) => `FAIL ${e}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write('brand tokens and assets valid\n');
