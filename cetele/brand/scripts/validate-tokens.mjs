// Validates cetele/brand: palette, light/dark schemes, WCAG contrast and the
// documented failures, typography and font files, spacing, radius, elevation,
// motion, logo SVG rules (incl. the adaptive safe circle), PNG renders and the
// README file table. Node only, no dependencies. Exit 1 on any failure.
// Usage: node cetele/brand/scripts/validate-tokens.mjs [brandDir] [--self-test]
import {
  readFileSync,
  existsSync,
  readdirSync,
  writeFileSync,
  cpSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const args = process.argv.slice(2);
const selfTest = args.includes('--self-test');
const dirArg = args.find((a) => !a.startsWith('--'));
const root = dirArg ? resolve(dirArg) : join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const fail = (msg) => errors.push(msg);
const ok = (msg) => console.log(`ok   ${msg}`);
const HEX6 = /^#[0-9A-F]{6}$/;
const HEX8 = /^#[0-9A-F]{8}$/;

let tokens;
try {
  tokens = JSON.parse(readFileSync(join(root, 'tokens.json'), 'utf8'));
} catch (e) {
  console.error(`FAIL tokens.json cannot be read: ${e.message}`);
  process.exit(1);
}
if (!/^1\.\d+\.\d+$/.test(tokens.version ?? '')) fail('tokens.version must be 1.x.y');

// ---------- palette (spec section 2) ----------
const SPEC = {
  defterLacivert: '#1E2A5A',
  centikTuruncu: '#E8712B',
  kagit: '#FAF7F0',
  murekkep: '#1A1A1A',
  odendiYesili: '#2E8B57',
  borcKirmizisi: '#C0392B',
  kursun: '#6B7280',
};
const palette = tokens.color?.palette ?? {};
for (const [k, v] of Object.entries(SPEC)) {
  if (palette[k]?.value !== v) fail(`palette.${k} must be ${v} (spec section 2)`);
  if (palette[k] && palette[k].derived !== false)
    fail(`palette.${k} is a core colour: derived must be false`);
}
const paletteByValue = new Map();
for (const [k, p] of Object.entries(palette)) {
  if (!HEX6.test(p.value) && !HEX8.test(p.value))
    fail(`palette.${k} ${p.value} is not #RRGGBB or #RRGGBBAA (upper case)`);
  if (typeof p.derived !== 'boolean') fail(`palette.${k} needs derived: true|false`);
  if (!SPEC[k] && p.derived !== true)
    fail(`palette.${k} is outside the spec palette: derived must be true`);
  if (p.derived === true && !(typeof p.use === 'string' && p.use.length > 8))
    fail(`palette.${k} is derived and needs a use note`);
  if (!p.name) fail(`palette.${k} needs a display name`);
  if (paletteByValue.has(p.value)) fail(`palette.${k} duplicates ${paletteByValue.get(p.value)}`);
  paletteByValue.set(p.value, k);
}
ok(
  `palette: ${Object.keys(SPEC).length} core colours match spec section 2, ${Object.keys(palette).length - Object.keys(SPEC).length} derived with use notes`,
);

// ---------- schemes ----------
const REQUIRED = [
  'background',
  'surface',
  'surfaceRaised',
  'surfaceSunken',
  'text',
  'textMuted',
  'border',
  'borderStrong',
  'primary',
  'onPrimary',
  'primaryText',
  'secondary',
  'onSecondary',
  'accent',
  'onAccent',
  'accentText',
  'debt',
  'onDebt',
  'debtText',
  'debtMark',
  'payment',
  'onPayment',
  'paymentText',
  'paymentMark',
  'error',
  'onError',
  'errorText',
  'focusRing',
  'overlay',
];
const schemes = tokens.color?.scheme ?? {};
const schemeNames = tokens.contrast?.schemes ?? [];
if (schemeNames.join() !== 'light,dark') fail('contrast.schemes must be ["light", "dark"]');
const roleSets = schemeNames.map((s) =>
  Object.keys(schemes[s] ?? {})
    .sort()
    .join(','),
);
if (new Set(roleSets).size !== 1)
  fail(`role names differ between schemes: ${schemeNames.join(' vs ')}`);
const roleDocs = tokens.color?.roles ?? {};
for (const r of REQUIRED) if (!roleDocs[r]) fail(`color.roles.${r} needs a description`);
for (const s of schemeNames) {
  const sc = schemes[s];
  if (!sc) {
    fail(`missing scheme ${s}`);
    continue;
  }
  for (const r of REQUIRED) if (!(r in sc)) fail(`${s}.${r} missing`);
  for (const r of Object.keys(sc))
    if (!REQUIRED.includes(r)) fail(`${s}.${r} is not a contract role`);
  for (const [r, v] of Object.entries(sc)) {
    const good = r === 'overlay' ? HEX8.test(v) : HEX6.test(v);
    if (!good) fail(`${s}.${r} ${v} has the wrong hex form`);
    if (!paletteByValue.has(v)) fail(`${s}.${r} ${v} is not declared in color.palette`);
  }
  // There is one red: error mirrors debt.
  for (const [e, d] of [
    ['error', 'debt'],
    ['onError', 'onDebt'],
    ['errorText', 'debtText'],
  ])
    if (sc[e] !== sc[d]) fail(`${s}.${e} must equal ${s}.${d} (one red)`);
  // The accent is a CTA fill only.
  for (const r of [
    'background',
    'surface',
    'surfaceRaised',
    'surfaceSunken',
    'text',
    'textMuted',
    'primary',
    'primaryText',
    'accentText',
    'secondary',
  ])
    if (sc[r] === sc.accent) fail(`${s}.${r} must not use the accent colour`);
  if (sc.accent !== SPEC.centikTuruncu) fail(`${s}.accent must be Çentik Turuncu`);
  if (sc.onAccent !== SPEC.murekkep)
    fail(`${s}.onAccent must be Mürekkep (Kâğıt and white fail on orange)`);
}
const L = schemes.light ?? {};
const D = schemes.dark ?? {};
for (const [r, v] of [
  ['primary', SPEC.defterLacivert],
  ['primaryText', SPEC.defterLacivert],
  ['surface', SPEC.kagit],
  ['onPrimary', SPEC.kagit],
  ['text', SPEC.murekkep],
  ['debt', SPEC.borcKirmizisi],
  ['paymentMark', SPEC.odendiYesili],
  ['borderStrong', SPEC.kursun],
])
  if (L[r] !== v) fail(`light.${r} must be ${v}`);
for (const [r, v] of [
  ['text', SPEC.kagit],
  ['onPrimary', SPEC.defterLacivert],
  ['paymentMark', SPEC.odendiYesili],
  ['borderStrong', SPEC.kursun],
])
  if (D[r] !== v) fail(`dark.${r} must be ${v}`);
const used = new Set(schemeNames.flatMap((s) => Object.values(schemes[s] ?? {})));
for (const [k, v] of Object.entries(SPEC))
  if (!used.has(v)) fail(`core colour ${k} is not used by any scheme role`);
for (const [k, p] of Object.entries(palette))
  if (p.derived && !used.has(p.value) && !/shadow/i.test(p.use))
    fail(`derived colour ${k} is not used by any scheme role`);
ok(`schemes: light and dark carry the same ${REQUIRED.length} roles, all values from the palette`);

// ---------- contrast ----------
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const C = tokens.contrast ?? {};
const results = {};
const check = (kind, min, pairs) => {
  for (const s of schemeNames) {
    for (const [fgRole, bgRole] of pairs) {
      const fg = schemes[s]?.[fgRole];
      const bg = schemes[s]?.[bgRole];
      if (!fg || !bg) {
        fail(`${kind} pair ${s}: ${fgRole}/${bgRole} uses an unknown role`);
        continue;
      }
      const r = ratio(fg, bg);
      const line = `${kind.padEnd(7)} ${s.padEnd(5)} ${fgRole} ${fg} on ${bgRole} ${bg} = ${r.toFixed(2)}`;
      (results[`${s} ${kind}`] ??= []).push({ r, line });
      if (r < min) fail(`${line} (< ${min})`);
      else console.log(`ok   ${line}`);
    }
  }
};
if (!(C.textMinimum >= 4.5)) fail('textMinimum must be at least 4.5 (WCAG AA)');
if (!(C.nonTextMinimum >= 3)) fail('nonTextMinimum must be at least 3 (WCAG AA non-text)');
check('text', C.textMinimum, C.pairs ?? []);
check('nontext', C.nonTextMinimum, C.nonTextPairs ?? []);
const SURFACES = ['background', 'surface', 'surfaceRaised', 'surfaceSunken'];
const has = (list, a, b) => (list ?? []).some(([x, y]) => x === a && y === b);
for (const t of [
  'text',
  'textMuted',
  'primaryText',
  'accentText',
  'debtText',
  'paymentText',
  'errorText',
])
  for (const sf of SURFACES) if (!has(C.pairs, t, sf)) fail(`contrast.pairs lacks ${t}/${sf}`);
for (const [on, fill] of [
  ['onPrimary', 'primary'],
  ['onSecondary', 'secondary'],
  ['onAccent', 'accent'],
  ['onDebt', 'debt'],
  ['onPayment', 'payment'],
  ['onError', 'error'],
])
  if (!has(C.pairs, on, fill)) fail(`contrast.pairs lacks ${on}/${fill}`);
for (const t of ['borderStrong', 'primary', 'focusRing', 'debtMark', 'paymentMark'])
  for (const sf of SURFACES)
    if (!has(C.nonTextPairs, t, sf)) fail(`contrast.nonTextPairs lacks ${t}/${sf}`);
for (const ex of Object.keys(C.excludedFromNonText ?? {}))
  if ((C.nonTextPairs ?? []).some(([a]) => a === ex))
    fail(`${ex} is excluded from non-text use but listed as a non-text pair`);
const accentDoc = (C.notValidForText ?? []).some(
  (n) => n.scheme === 'light' && n.foreground === 'accent' && n.background === 'surface',
);
if (!accentDoc)
  fail('notValidForText must document light accent on surface (Çentik Turuncu on Kâğıt)');
for (const n of C.notValidForText ?? []) {
  const fg = schemes[n.scheme]?.[n.foreground];
  const bg = schemes[n.scheme]?.[n.background];
  if (!fg || !bg || !n.reason) {
    fail(`notValidForText ${n.scheme} ${n.foreground}/${n.background} is incomplete`);
    continue;
  }
  const r = ratio(fg, bg);
  if (r >= C.textMinimum)
    fail(
      `notValidForText ${n.scheme} ${n.foreground}/${n.background} actually passes (${r.toFixed(2)})`,
    );
  else
    console.log(
      `doc  not for text: ${n.scheme} ${n.foreground} ${fg} on ${n.background} ${bg} = ${r.toFixed(2)}`,
    );
  if (has(C.pairs, n.foreground, n.background))
    fail(
      `${n.foreground}/${n.background} is documented as not valid for text but listed as a text pair`,
    );
}
for (const n of C.notValidForFill ?? []) {
  const fg = schemes[n.scheme]?.[n.fill];
  const bg = schemes[n.scheme]?.[n.background];
  if (!fg || !bg || !n.reason) {
    fail(`notValidForFill ${n.scheme} ${n.fill}/${n.background} is incomplete`);
    continue;
  }
  const r = ratio(fg, bg);
  if (r >= n.minimum)
    fail(`notValidForFill ${n.scheme} ${n.fill}/${n.background} actually passes (${r.toFixed(2)})`);
  else
    console.log(
      `doc  not as fill: ${n.scheme} ${n.fill} ${fg} on ${n.background} ${bg} = ${r.toFixed(2)}`,
    );
  if (has(C.nonTextPairs, n.fill, n.background))
    fail(`${n.fill}/${n.background} is documented as invalid but listed as a non-text pair`);
}

// ---------- typography ----------
const typo = tokens.typography ?? {};
const fams = typo.families ?? {};
if (fams.display?.name !== 'Manrope' || fams.display?.weights?.join() !== '700')
  fail('typography.families.display must be Manrope 700 (spec section 2)');
if (fams.body?.name !== 'Inter' || fams.body?.weights?.join() !== '400,500,600')
  fail('typography.families.body must be Inter 400/500/600 (spec section 2)');
const AMOUNT = ['amount', 'amountLarge'];
for (const [name, s] of Object.entries(typo.scale ?? {})) {
  const fam = fams[s.family];
  if (!fam) {
    fail(`type.${name}: unknown family ${s.family}`);
    continue;
  }
  if (!fam.weights.includes(s.weight)) fail(`type.${name}: ${fam.name} has no weight ${s.weight}`);
  for (const ctx of ['app', 'web']) {
    const m = s[ctx];
    if (!m) {
      fail(`type.${name}.${ctx} missing`);
      continue;
    }
    if (m.lineHeight < m.size) fail(`type.${name}.${ctx}: lineHeight < size`);
    if (m.size < 14) fail(`type.${name}.${ctx}: size below 14`);
    if (fam.minSize && m.size < fam.minSize)
      fail(`type.${name}.${ctx}: ${fam.name} below ${fam.minSize}`);
  }
  if (!s.use || !s.m3) fail(`type.${name}: needs use and m3 notes`);
  const hasTnum = (s.features ?? []).includes('tnum');
  if (AMOUNT.includes(name) !== hasTnum)
    fail(`type.${name}: tnum belongs to the amount styles only`);
}
for (const n of AMOUNT) if (!typo.scale?.[n]) fail(`type.${n} missing`);
for (const n of ['body', 'label'])
  if (!(typo.scale?.[n]?.app?.size >= 16)) fail(`type.${n} below 16 sp (spec section 8)`);

// Font files: hash, static, OS/2 weight, family name, cmap, GSUB features.
const fontTables = (buf) => {
  const out = {};
  const n = buf.readUInt16BE(4);
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    const tag = buf.toString('latin1', r, r + 4);
    const off = buf.readUInt32BE(r + 8);
    out[tag] = buf.subarray(off, off + buf.readUInt32BE(r + 12));
  }
  return out;
};
const cmapOf = (t) => {
  const cps = new Set();
  const subtables = t.readUInt16BE(2);
  for (let i = 0; i < subtables; i++) {
    const rec = 4 + i * 8;
    const platform = t.readUInt16BE(rec);
    const st = t.readUInt32BE(rec + 4);
    const format = t.readUInt16BE(st);
    if (platform !== 3 && platform !== 0) continue;
    if (format === 4) {
      const segX2 = t.readUInt16BE(st + 6);
      const ends = st + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const offsets = deltas + segX2;
      for (let sg = 0; sg < segX2 / 2; sg++) {
        const end = t.readUInt16BE(ends + sg * 2);
        const start = t.readUInt16BE(starts + sg * 2);
        const delta = t.readInt16BE(deltas + sg * 2);
        const roAt = offsets + sg * 2;
        const ro = t.readUInt16BE(roAt);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          const gid = ro === 0 ? (c + delta) & 0xffff : t.readUInt16BE(roAt + ro + (c - start) * 2);
          if (gid !== 0) cps.add(c);
        }
      }
    } else if (format === 12) {
      const groups = t.readUInt32BE(st + 12);
      for (let g = 0; g < groups; g++) {
        const o = st + 16 + g * 12;
        for (let c = t.readUInt32BE(o); c <= t.readUInt32BE(o + 4); c++) cps.add(c);
      }
    }
  }
  return cps;
};
const gsubOf = (t) => {
  const scriptList = t.readUInt16BE(4);
  const featureList = t.readUInt16BE(6);
  const langs = new Set();
  const sc = t.readUInt16BE(scriptList);
  for (let i = 0; i < sc; i++) {
    const so = scriptList + t.readUInt16BE(scriptList + 2 + i * 6 + 4);
    const lc = t.readUInt16BE(so + 2);
    for (let j = 0; j < lc; j++) langs.add(t.toString('latin1', so + 4 + j * 6, so + 8 + j * 6));
  }
  const feats = new Set();
  const fc = t.readUInt16BE(featureList);
  for (let i = 0; i < fc; i++)
    feats.add(t.toString('latin1', featureList + 2 + i * 6, featureList + 6 + i * 6));
  return { langs, feats };
};
const nameOf = (t, id) => {
  const count = t.readUInt16BE(2);
  const strOff = t.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    if (t.readUInt16BE(r) !== 3 || t.readUInt16BE(r + 6) !== id) continue;
    const len = t.readUInt16BE(r + 8);
    const off = strOff + t.readUInt16BE(r + 10);
    let s = '';
    for (let k = 0; k < len; k += 2) s += String.fromCharCode(t.readUInt16BE(off + k));
    return s;
  }
  return '';
};
const glyphs = [...(typo.requiredGlyphs ?? '')];
if (typo.requiredGlyphs !== 'çğıİöşüÇĞÖŞÜ₺')
  fail('typography.requiredGlyphs must be çğıİöşüÇĞÖŞÜ₺');
const covered = { display: new Set(), body: new Set() };
for (const lic of typo.licences ?? []) {
  const p = join(root, lic);
  if (!existsSync(p)) fail(`missing ${lic}`);
  else if (!/SIL Open Font License, Version 1\.1/.test(readFileSync(p, 'utf8')))
    fail(`${lic} is not the SIL OFL 1.1 text`);
}
for (const fam of ['manrope', 'inter'])
  if (!(typo.licences ?? []).includes(`fonts/${fam}/OFL.txt`))
    fail(`typography.licences lacks fonts/${fam}/OFL.txt`);
for (const f of typo.fontFiles ?? []) {
  const p = join(root, f.file);
  if (!existsSync(p)) {
    fail(`missing font ${f.file}`);
    continue;
  }
  const buf = readFileSync(p);
  const hash = createHash('sha256').update(buf).digest('hex');
  if (hash !== f.sha256) fail(`${f.file}: sha256 ${hash} differs from tokens.json`);
  if (buf.readUInt32BE(0) !== 0x00010000) {
    fail(`${f.file}: not a TrueType (glyf) font`);
    continue;
  }
  const t = fontTables(buf);
  if (t.fvar) fail(`${f.file}: variable font, a static instance is required`);
  const w = t['OS/2'].readUInt16BE(4);
  if (w !== f.weight) fail(`${f.file}: OS/2 weight ${w} != ${f.weight}`);
  const famName = fams[f.family]?.name;
  const nameFamily = nameOf(t.name, 16) || nameOf(t.name, 1);
  if (!famName || nameFamily !== famName)
    fail(`${f.file}: name table family "${nameFamily}" != ${famName}`);
  if (!/^[a-z][a-z0-9_]*\.ttf$/.test(f.androidRes ?? ''))
    fail(`${f.file}: androidRes must be a valid res/font name`);
  const cps = cmapOf(t.cmap);
  const missing = glyphs.filter((ch) => !cps.has(ch.codePointAt(0)));
  if (missing.length) fail(`${f.file} lacks glyphs: ${missing.join(' ')}`);
  const { langs, feats } = gsubOf(t.GSUB);
  for (const ft of typo.requiredFeatures ?? [])
    if (!feats.has(ft)) fail(`${f.file}: GSUB lacks ${ft}`);
  if (langs.has('TRK ') !== f.trk)
    fail(`${f.file}: tokens say trk ${f.trk}, the font says ${langs.has('TRK ')}`);
  covered[f.family]?.add(f.weight);
  console.log(
    `font ${f.file}: ${(buf.length / 1024).toFixed(1)} KB, static, OS/2 ${w}, family "${nameFamily}", ${cps.size} code points, ${missing.length ? 'MISSING glyphs' : 'çğıİöşüÇĞÖŞÜ₺ present'}, tnum ${feats.has('tnum')}, TRK ${langs.has('TRK ')}, sha256 ${hash.slice(0, 12)}`,
  );
}
for (const [fam, def] of Object.entries(fams))
  for (const w of def.weights ?? [])
    if (!covered[fam]?.has(w)) fail(`no font file for ${def.name} ${w}`);
const fontDirFiles = ['manrope', 'inter'].flatMap((d) =>
  existsSync(join(root, 'fonts', d))
    ? readdirSync(join(root, 'fonts', d))
        .filter((n) => /\.(ttf|otf|woff2?)$/.test(n))
        .map((n) => `fonts/${d}/${n}`)
    : [],
);
for (const f of fontDirFiles)
  if (!(typo.fontFiles ?? []).some((x) => x.file === f))
    fail(`${f} is on disk but not declared in typography.fontFiles`);

// ---------- spacing, layout, radius, shape, elevation, motion ----------
for (const [name, v] of Object.entries(tokens.spacing ?? {}))
  if (!Number.isInteger(v) || v % 4 !== 0) fail(`spacing.${name}=${v} is off the 4-pt grid`);
const lay = tokens.layout ?? {};
if (lay.touchTarget < 48) fail('layout.touchTarget below 48 dp (spec section 8)');
for (const k of ['screenGutter', 'rowMinHeight', 'fabSize'])
  if (!Number.isInteger(lay[k]) || lay[k] % 4 !== 0) fail(`layout.${k} must be a multiple of 4`);
for (const [k, v] of Object.entries(tokens.radius ?? {}))
  if (!Number.isInteger(v) || (v !== 9999 && (v % 4 !== 0 || v > 32)))
    fail(`radius.${k}=${v} must be a multiple of 4 up to 32 (or 9999)`);
for (const k of ['chip', 'button', 'input', 'card', 'sheet', 'dialog'])
  if (!(k in (tokens.radius ?? {}))) fail(`radius.${k} missing`);
const sh = tokens.shape ?? {};
const shapeOrder = ['extraSmall', 'small', 'medium', 'large', 'extraLarge'];
for (let i = 0; i < shapeOrder.length; i++) {
  if (!Number.isInteger(sh[shapeOrder[i]])) fail(`shape.${shapeOrder[i]} missing`);
  if (i && sh[shapeOrder[i]] < sh[shapeOrder[i - 1]])
    fail(`shape.${shapeOrder[i]} smaller than ${shapeOrder[i - 1]}`);
}
for (const s of schemeNames)
  if (!HEX8.test(tokens.elevation?.shadow?.[s]?.color ?? ''))
    fail(`elevation.shadow.${s}.color must be #RRGGBBAA`);
for (const [k, v] of Object.entries(tokens.elevation?.levels ?? {}))
  if (!Number.isInteger(v) || v < 0 || v > 12) fail(`elevation.levels.${k}=${v} out of range`);
for (const [name, v] of Object.entries(tokens.motion?.duration ?? {}))
  if (!Number.isInteger(v) || v < 0 || v > 1000) fail(`motion.duration.${name}=${v} out of range`);
for (const [name, v] of Object.entries(tokens.motion?.easing ?? {}))
  if (!Array.isArray(v) || v.length !== 4 || v.some((n) => typeof n !== 'number'))
    fail(`motion.easing.${name} must be 4 numbers`);
if (!tokens.motion?.reducedMotion) fail('motion.reducedMotion rule missing');

// ---------- SVG structure rules ----------
const paletteHex = new Set([...paletteByValue.keys()].filter((v) => HEX6.test(v)));
const allIds = new Map();
let svgCount = 0;
const checkSvg = (file) => {
  svgCount++;
  const p = join(root, file);
  if (!existsSync(p)) return fail(`missing ${file}`);
  const s = readFileSync(p, 'utf8');
  if (!s.startsWith('<svg ') || !s.trimEnd().endsWith('</svg>'))
    return fail(`${file}: must start with <svg and end with </svg>`);
  if (!/^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(s))
    fail(`${file}: missing svg xmlns`);
  if (!/^<svg [^>]*viewBox="[-\d. ]+"/.test(s)) fail(`${file}: missing viewBox`);
  if (
    !/^<svg [^>]*role="img"[^>]*aria-label="Çetele"/.test(s) ||
    !s.includes('<title>Çetele</title>')
  )
    fail(`${file}: needs role="img", aria-label="Çetele" and <title>`);
  for (const bad of [
    '<text',
    '<tspan',
    '<image',
    '<script',
    '<style',
    '<!--',
    '<metadata',
    '<foreignObject',
    '<?xml',
    '<!DOCTYPE',
    '@import',
    '<use',
  ])
    if (s.includes(bad)) fail(`${file}: contains forbidden ${bad}`);
  if (/inkscape|sodipodi|illustrator|sketch:|figma|generator|data-name/i.test(s))
    fail(`${file}: editor metadata`);
  if (/href\s*=/.test(s)) fail(`${file}: href is not allowed`);
  if (/url\(/.test(s)) fail(`${file}: url() is not allowed`);
  if (/\son[a-z]+\s*=/.test(s)) fail(`${file}: event handler attribute`);
  if (/Gradient|<filter|\sfilter=|<mask|<pattern|<clipPath|opacity=/i.test(s))
    fail(
      `${file}: gradients, filters, masks, patterns, clips and opacity are not part of the flat identity`,
    );
  if (/transform=/.test(s)) fail(`${file}: no transforms (geometry is absolute)`);
  for (const m of s.matchAll(/#[0-9A-Fa-f]{3,8}\b/g))
    if (!paletteHex.has(m[0].toUpperCase())) fail(`${file}: colour ${m[0]} is not a palette value`);
  for (const [, id] of s.matchAll(/\sid="([^"]+)"/g)) {
    if (allIds.has(id) && allIds.get(id) !== file)
      fail(`${file}: id "${id}" also used in ${allIds.get(id)}`);
    allIds.set(id, file);
  }
  const stack = [];
  const tag = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g;
  let m;
  let roots = 0;
  while ((m = tag.exec(s))) {
    const [, close, name, attrs, selfClose] = m;
    if ((attrs.match(/"/g) ?? []).length % 2) fail(`${file}: unbalanced quotes in <${name}>`);
    if (close) {
      if (stack.pop() !== name) return fail(`${file}: mismatched </${name}>`);
    } else if (!selfClose) {
      if (stack.length === 0) roots++;
      stack.push(name);
    } else if (stack.length === 0) roots++;
  }
  if (stack.length) fail(`${file}: unclosed <${stack.join('>, <')}>`);
  if (roots !== 1) fail(`${file}: expected exactly one root element, found ${roots}`);
  return s;
};

// Path geometry: absolute M L H V A Z only. Returns sampled points per stroke.
const num = (str) => (str.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
const arcPoints = (x1, y1, rx, ry, phi, fa, fs, x2, y2, n = 96) => {
  // SVG implementation notes F.6.5 (rx = ry, phi = 0 in this brand).
  if (phi !== 0 || rx !== ry) fail('arcs must be circular with no rotation');
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const d2 = dx * dx + dy * dy;
  const r = Math.max(rx, Math.sqrt(d2));
  const co = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, (r * r - d2) / d2));
  const cx = co * dy + (x1 + x2) / 2;
  const cy = -co * dx + (y1 + y2) / 2;
  const a1 = Math.atan2((y1 - cy) / r, (x1 - cx) / r);
  let da = Math.atan2((y2 - cy) / r, (x2 - cx) / r) - a1;
  if (fs && da < 0) da += 2 * Math.PI;
  if (!fs && da > 0) da -= 2 * Math.PI;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a1 + (da * i) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return { pts, cx, cy, r, sweep: Math.abs(da) };
};
const strokesOf = (s) => {
  const out = [];
  for (const [el] of s.matchAll(/<path [^>]*>/g)) {
    const d = el.match(/\sd="([^"]+)"/)?.[1] ?? '';
    const stroked = /stroke="#/.test(el);
    const w = stroked ? Number(el.match(/stroke-width="([\d.]+)"/)?.[1] ?? 1) : 0;
    const col = el.match(/stroke="(#[0-9A-F]{6})"/)?.[1] ?? el.match(/fill="(#[0-9A-F]{6})"/)?.[1];
    if (/[a-z]/.test(d.replace(/e-?\d/g, ''))) fail('logo paths must use absolute commands');
    let x = 0;
    let y = 0;
    for (const [, cmd, a] of d.matchAll(/([MLHVAZ])([^MLHVAZ]*)/g)) {
      const n = num(a);
      const seg = { cmd, w, col, pts: [[x, y]] };
      if (cmd === 'M') {
        [x, y] = n;
        out.push({ cmd, w, col, pts: [[x, y]] });
        continue;
      }
      if (cmd === 'L') [x, y] = n;
      else if (cmd === 'H') x = n[0];
      else if (cmd === 'V') y = n[0];
      else if (cmd === 'A') {
        const arc = arcPoints(x, y, n[0], n[1], n[2], n[3], n[4], n[5], n[6]);
        [x, y] = [n[5], n[6]];
        out.push({ cmd, w, col, pts: arc.pts, arc });
        continue;
      } else continue;
      seg.pts.push([x, y]);
      out.push(seg);
    }
  }
  return out;
};

// ---------- logo ----------
const LOGO = [
  'logo/cetele-mark.svg',
  'logo/cetele-wordmark-light.svg',
  'logo/cetele-wordmark-dark.svg',
  'logo/cetele-wordmark-mono.svg',
  'logo/cetele-app-icon.svg',
  'logo/cetele-adaptive-foreground.svg',
  'logo/cetele-adaptive-background.svg',
  'logo/cetele-adaptive-monochrome.svg',
  'logo/cetele-favicon.svg',
];
const MARK_BEARING = [
  'logo/cetele-mark.svg',
  'logo/cetele-app-icon.svg',
  'logo/cetele-adaptive-foreground.svg',
  'logo/cetele-adaptive-monochrome.svg',
  'logo/cetele-favicon.svg',
];
const LOGO_PNG = [
  'logo/png/cetele-mark-1024.png',
  'logo/png/cetele-app-icon-1024.png',
  'logo/png/cetele-adaptive-foreground-1024.png',
  'logo/png/cetele-adaptive-background-1024.png',
  'logo/png/cetele-adaptive-monochrome-1024.png',
];
const logoDir = join(root, 'logo');
if (existsSync(logoDir)) {
  const onDisk = readdirSync(logoDir)
    .filter((n) => n.endsWith('.svg'))
    .map((n) => `logo/${n}`)
    .sort();
  if (onDisk.join() !== [...LOGO].sort().join())
    fail(`logo/ SVG list differs from the contract: on disk [${onDisk.join(', ')}]`);
}
const src = {};
for (const f of LOGO) src[f] = checkSvg(f);
const viewOf = (s) => s?.match(/viewBox="([^"]+)"/)?.[1];
// Concept: one C ring (a single large arc), four vertical bars, one diagonal cedilla below the ring.
for (const f of MARK_BEARING) {
  const s = src[f];
  if (!s) continue;
  const segs = strokesOf(s);
  const arcs = segs.filter((g) => g.cmd === 'A');
  const bars = segs.filter((g) => g.cmd === 'V');
  const diags = segs.filter(
    (g) =>
      g.cmd === 'L' &&
      Math.abs(g.pts[1][0] - g.pts[0][0]) > 0.1 &&
      Math.abs(g.pts[1][1] - g.pts[0][1]) > 0.1,
  );
  if (arcs.length !== 1 || arcs[0].arc.sweep < Math.PI * 1.3 || arcs[0].arc.sweep > Math.PI * 1.75)
    fail(`${f}: the C must be one open arc of 234 to 315 degrees`);
  if (bars.length !== 4)
    fail(`${f}: needs exactly four vertical tally strokes, found ${bars.length}`);
  if (diags.length !== 1)
    fail(`${f}: needs exactly one diagonal stroke (the cedilla), found ${diags.length}`);
  if (arcs.length === 1 && bars.length === 4 && diags.length === 1) {
    const { cx, cy, r } = arcs[0].arc;
    const inner = r - arcs[0].w / 2;
    for (const b of bars)
      for (const [x, y] of b.pts)
        if (Math.hypot(x - cx, y - cy) + b.w / 2 > inner + 0.01)
          fail(`${f}: tally stroke at x=${x} leaves the counter of the C`);
    const [[ax, ay], [bx, by]] = diags[0].pts;
    const top = Math.min(ay, by);
    if (top < cy + r) fail(`${f}: the cedilla must sit below the C`);
    const lowX = ay > by ? ax : bx;
    const highX = ay > by ? bx : ax;
    if (!(lowX < highX)) fail(`${f}: the cedilla runs from upper right to lower left`);
    const widths = new Set(bars.map((b) => b.w));
    const bw = bars[0].w;
    // The cedilla is the fifth notch: the bars' weight, up to 1.5x on the 20-grid favicon.
    if (widths.size !== 1 || diags[0].w < bw || diags[0].w > bw * 1.5)
      fail(`${f}: the cedilla must carry the weight of the tally strokes (1 to 1.5 times)`);
    if (arcs[0].w <= bw) fail(`${f}: the C ring is heavier than the tally strokes`);
  }
}
for (const f of LOGO.filter((x) => x.includes('wordmark'))) {
  const s = src[f];
  if (!s) continue;
  if (!/<path fill="(#[0-9A-F]{6}|currentColor)" d="M/.test(s))
    fail(`${f}: wordmark must be outlined paths`);
  if (/stroke=/.test(s)) fail(`${f}: wordmark outlines are fills, not strokes`);
  // Outline sanity: every point inside the viewBox (control points may overshoot 2 %), extents touch it.
  const [vx, vy, vw, vh] = num(viewOf(s) ?? '');
  const xs = [];
  const ys = [];
  for (const [, d] of s.matchAll(/\sd="([^"]+)"/g)) {
    if (/[^MLHVQCZ\d\s.,-]/.test(d)) fail(`${f}: unexpected path command`);
    for (const [, cmd, a] of d.matchAll(/([MLHVQCZ])([^MLHVQCZ]*)/g)) {
      const n = num(a);
      if (cmd === 'H') xs.push(...n);
      else if (cmd === 'V') ys.push(...n);
      else for (let i = 0; i + 1 < n.length; i += 2) (xs.push(n[i]), ys.push(n[i + 1]));
    }
  }
  const tol = 0.02;
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  if (
    x0 < vx - vw * tol ||
    x1 > vx + vw * (1 + tol) ||
    y0 < vy - vh * tol ||
    y1 > vy + vh * (1 + tol)
  )
    fail(`${f}: outline points leave the viewBox`);
  if (
    Math.abs(x0 - vx) > vw * tol ||
    Math.abs(x1 - (vx + vw)) > vw * tol ||
    Math.abs(y0 - vy) > vh * tol ||
    Math.abs(y1 - (vy + vh)) > vh * tol
  )
    fail(`${f}: outline does not fill its viewBox (corrupt geometry?)`);
}
{
  const outlines = LOGO.filter((x) => x.includes('wordmark')).map((f) =>
    [...(src[f] ?? '').matchAll(/\sd="([^"]+)"/g)]
      .map((m) => m[1])
      .join(' ')
      .replace(/\s+/g, ' '),
  );
  if (new Set(outlines).size !== 1) fail('the three wordmarks must share identical outlines');
}
const expectColours = {
  'logo/cetele-mark.svg': [SPEC.defterLacivert, SPEC.centikTuruncu],
  'logo/cetele-app-icon.svg': [SPEC.defterLacivert, SPEC.kagit],
  'logo/cetele-adaptive-foreground.svg': [SPEC.kagit],
  'logo/cetele-adaptive-background.svg': [SPEC.defterLacivert],
  'logo/cetele-adaptive-monochrome.svg': [SPEC.murekkep],
  'logo/cetele-favicon.svg': [SPEC.defterLacivert, SPEC.kagit],
  'logo/cetele-wordmark-light.svg': [SPEC.defterLacivert, SPEC.centikTuruncu],
  'logo/cetele-wordmark-dark.svg': [SPEC.kagit, SPEC.centikTuruncu],
  'logo/cetele-wordmark-mono.svg': [],
};
for (const [f, cols] of Object.entries(expectColours)) {
  const s = src[f];
  if (!s) continue;
  const found = [...new Set([...s.matchAll(/#[0-9A-F]{6}/g)].map((m) => m[0]))].sort();
  if (found.join() !== [...cols].sort().join())
    fail(`${f}: colours [${found.join(', ')}] differ from [${cols.join(', ')}]`);
}
if (
  src['logo/cetele-wordmark-mono.svg'] &&
  !src['logo/cetele-wordmark-mono.svg'].includes('fill="currentColor"')
)
  fail('logo/cetele-wordmark-mono.svg: mono uses currentColor');
for (const [f, vb] of [
  ['logo/cetele-app-icon.svg', '0 0 1024 1024'],
  ['logo/cetele-adaptive-foreground.svg', '0 0 108 108'],
  ['logo/cetele-adaptive-background.svg', '0 0 108 108'],
  ['logo/cetele-adaptive-monochrome.svg', '0 0 108 108'],
  ['logo/cetele-favicon.svg', '0 0 20 20'],
])
  if (src[f] && viewOf(src[f]) !== vb) fail(`${f}: viewBox must be ${vb}`);
if (
  src['logo/cetele-app-icon.svg'] &&
  !src['logo/cetele-app-icon.svg'].includes('<rect width="1024" height="1024" fill="#1E2A5A"/>')
)
  fail('logo/cetele-app-icon.svg: full-bleed Defter Lacivert square (stores apply the mask)');
if (
  src['logo/cetele-adaptive-background.svg'] &&
  !src['logo/cetele-adaptive-background.svg'].includes(
    '<rect width="108" height="108" fill="#1E2A5A"/>',
  )
)
  fail('logo/cetele-adaptive-background.svg: full 108 dp Defter Lacivert layer');
// Adaptive layers: all ink inside the 66 dp safe circle (radius 33 around 54,54), incl. half stroke.
for (const f of ['logo/cetele-adaptive-foreground.svg', 'logo/cetele-adaptive-monochrome.svg']) {
  const s = src[f];
  if (!s) continue;
  if (/<rect|<circle|<ellipse|<polygon|<line/.test(s))
    fail(`${f}: only stroked paths are expected`);
  let far = 0;
  for (const g of strokesOf(s)) {
    if (!g.w) fail(`${f}: unstroked path`);
    for (const [x, y] of g.pts) far = Math.max(far, Math.hypot(x - 54, y - 54) + g.w / 2);
  }
  if (far > 33)
    fail(`${f}: ink reaches ${far.toFixed(2)} dp from the centre (> 33, outside the safe circle)`);
  else ok(`${f}: ink within ${far.toFixed(2)} dp of the centre (safe circle 33)`);
}
{
  const fg = src['logo/cetele-adaptive-foreground.svg'];
  const mono = src['logo/cetele-adaptive-monochrome.svg'];
  if (fg && mono && fg.replaceAll(SPEC.kagit, 'X') !== mono.replaceAll(SPEC.murekkep, 'X'))
    fail('adaptive monochrome must be the foreground geometry in one colour');
}

// ---------- PNG renders: signature, size, only IHDR/IDAT/IEND, CRCs, decodable ----------
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const checkPng = (f, ew, eh) => {
  const p = join(root, f);
  if (!existsSync(p)) return fail(`missing ${f}`);
  const b = readFileSync(p);
  if (b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a)
    return fail(`${f}: not a PNG`);
  const types = [];
  const idat = [];
  for (let o = 8; o < b.length;) {
    const len = b.readUInt32BE(o);
    const type = b.toString('latin1', o + 4, o + 8);
    const body = b.subarray(o + 8, o + 8 + len);
    if (crc32(b.subarray(o + 4, o + 8 + len)) !== b.readUInt32BE(o + 8 + len))
      fail(`${f}: bad CRC in ${type}`);
    types.push(type);
    if (type === 'IDAT') idat.push(body);
    o += 12 + len;
  }
  const extra = [...new Set(types.filter((t) => !['IHDR', 'IDAT', 'IEND'].includes(t)))];
  if (extra.length) fail(`${f}: chunks other than IHDR/IDAT/IEND: ${extra.join(', ')}`);
  if (types[0] !== 'IHDR' || types.at(-1) !== 'IEND') fail(`${f}: IHDR first and IEND last`);
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  if (w !== ew || h !== eh) fail(`${f}: expected ${ew}x${eh}, got ${w}x${h}`);
  const colourType = b[25];
  const channels = { 2: 3, 6: 4 }[colourType];
  if (b[24] !== 8 || !channels) return fail(`${f}: expected 8-bit RGB or RGBA`);
  let raw;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch (e) {
    return fail(`${f}: IDAT does not inflate (${e.message})`);
  }
  if (b[28] !== 0) return fail(`${f}: interlaced PNG`);
  const stride = w * channels;
  if (raw.length !== h * (stride + 1)) return fail(`${f}: decoded size mismatch`);
  // Undo the scanline filters, then measure coverage (share of non-transparent pixels).
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? px[y * stride + i - channels] : 0;
      const up = y ? px[(y - 1) * stride + i] : 0;
      const c = y && i >= channels ? px[(y - 1) * stride + i - channels] : 0;
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += up;
      else if (ft === 3) v += (a + up) >> 1;
      else if (ft === 4) {
        const p = a + up - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      } else if (ft !== 0) return fail(`${f}: unknown filter ${ft}`);
      px[y * stride + i] = v & 0xff;
    }
  }
  let opaque = 0;
  for (let i = channels - 1; i < px.length; i += channels)
    if (channels === 3 || px[i] > 0) opaque++;
  const cover = opaque / (w * h);
  if (cover === 0) fail(`${f}: render is fully transparent`);
  ok(
    `${f}: ${w}x${h}, chunks ${[...new Set(types)].join('/')}, CRCs valid, ${channels === 4 ? 'RGBA' : 'RGB'}, ${(cover * 100).toFixed(1)} % covered`,
  );
  return cover;
};
const coverage = {};
for (const f of LOGO_PNG) coverage[f] = checkPng(f, 1024, 1024);
if (
  coverage['logo/png/cetele-app-icon-1024.png'] !== undefined &&
  coverage['logo/png/cetele-app-icon-1024.png'] < 1
)
  fail('logo/png/cetele-app-icon-1024.png must be fully opaque (store icon)');
if (
  coverage['logo/png/cetele-adaptive-background-1024.png'] !== undefined &&
  coverage['logo/png/cetele-adaptive-background-1024.png'] < 1
)
  fail('logo/png/cetele-adaptive-background-1024.png must be fully opaque');
for (const f of ['logo/png/cetele-adaptive-foreground-1024.png', 'logo/png/cetele-mark-1024.png'])
  if (coverage[f] !== undefined && coverage[f] >= 0.6)
    fail(`${f}: should be transparent around the mark`);
const pngDir = join(root, 'logo', 'png');
if (existsSync(pngDir)) {
  const onDisk = readdirSync(pngDir)
    .map((n) => `logo/png/${n}`)
    .sort();
  if (onDisk.join() !== [...LOGO_PNG].sort().join())
    fail(`logo/png list differs from the contract: on disk [${onDisk.join(', ')}]`);
}
console.log(`svg checked: ${svgCount}; ids: ${allIds.size}`);

// ---------- guardrails over every text file ----------
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
const files = walk(root)
  .map((p) => p.slice(root.length + 1).replaceAll('\\', '/'))
  .sort();
// The words are assembled at run time so this file passes its own scan.
const placeholder = new RegExp(
  `\\b(${['TO' + 'DO', 'FIX' + 'ME', 'X' + 'XX'].join('|')})\\b|lor${'em'} ipsum|YOUR${'_'}`,
  'i',
);
for (const rel of files) {
  if (!/\.(svg|json|md|mjs)$/.test(rel)) continue;
  const s = readFileSync(join(root, rel), 'utf8');
  if (placeholder.test(s)) fail(`${rel}: placeholder text`);
  if (
    /text-transform\s*:\s*uppercase/i.test(s) ||
    (/toUpperCase\(/.test(s) && !rel.endsWith('validate-tokens.mjs'))
  )
    fail(`${rel}: uppercase transforms are banned (Turkish casing)`);
}

// ---------- README file table equals the disk ----------
{
  const readme = existsSync(join(root, 'README.md'))
    ? readFileSync(join(root, 'README.md'), 'utf8')
    : '';
  const section = readme.split(/^## Files\s*$/m)[1]?.split(/^## /m)[0] ?? '';
  const listed = [...section.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1]).sort();
  const notListed = files.filter((f) => !listed.includes(f));
  const notOnDisk = listed.filter((f) => !files.includes(f));
  if (!section) fail("README.md needs a '## Files' table");
  if (notListed.length) fail(`README.md Files table lacks: ${notListed.join(', ')}`);
  if (notOnDisk.length) fail(`README.md lists files that do not exist: ${notOnDisk.join(', ')}`);
  if (section && !notListed.length && !notOnDisk.length)
    ok(`README.md Files table matches the ${files.length} files on disk`);
}

// ---------- result ----------
for (const k of Object.keys(results).sort()) {
  const low = results[k].sort((a, b) => a.r - b.r).slice(0, 3);
  console.log(`lowest ${k}: ${low.map((x) => x.line.replace(/^\S+\s+\S+\s+/, '')).join(' | ')}`);
}
if (errors.length) {
  console.error(errors.map((e) => `FAIL ${e}`).join('\n'));
  console.error(`${errors.length} failure(s)`);
  process.exit(1);
}
console.log('cetele brand valid');

// ---------- self-test: a deliberately broken copy must fail on every planted defect ----------
if (selfTest) {
  const tmp = mkdtempSync(join(tmpdir(), 'cetele-brand-selftest-'));
  cpSync(root, tmp, { recursive: true });
  const t = JSON.parse(readFileSync(join(tmp, 'tokens.json'), 'utf8'));
  t.color.scheme.dark.textMuted = '#6B7280';
  t.color.scheme.light.secondary = t.color.scheme.light.accent;
  delete t.color.scheme.dark.paymentText;
  t.typography.fontFiles[1].weight = 500;
  writeFileSync(join(tmp, 'tokens.json'), JSON.stringify(t));
  const mark = join(tmp, 'logo/cetele-mark.svg');
  writeFileSync(
    mark,
    readFileSync(mark, 'utf8').replace(
      '</svg>',
      '<text x="0" y="0">Ç</text><image href="https://example.invalid/x.png"/></svg>',
    ),
  );
  const fg = join(tmp, 'logo/cetele-adaptive-foreground.svg');
  writeFileSync(
    fg,
    readFileSync(fg, 'utf8').replace(/M(\d+\.?\d*) /, (m, x) => `M${Number(x) + 30} `),
  );
  const icon = join(tmp, 'logo/cetele-favicon.svg');
  writeFileSync(icon, readFileSync(icon, 'utf8').replace('M13.5 5.5V10.5', ''));
  const png = join(tmp, 'logo/png/cetele-app-icon-1024.png');
  const pb = readFileSync(png);
  const text = Buffer.from('tEXtComment\0x');
  const chunk = Buffer.alloc(12 + text.length - 4);
  chunk.writeUInt32BE(text.length - 4, 0);
  text.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(text), 8 + text.length - 4);
  writeFileSync(png, Buffer.concat([pb.subarray(0, 33), chunk, pb.subarray(33)]));
  writeFileSync(join(tmp, 'logo/extra.svg'), '<svg></svg>');
  const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), tmp], {
    encoding: 'utf8',
  });
  rmSync(tmp, { recursive: true, force: true });
  const out = `${run.stdout}${run.stderr}`;
  const expected = [
    'dark  textMuted #6B7280 on background',
    'light.secondary must not use the accent colour',
    'role names differ between schemes',
    'OS/2 weight 400 != 500',
    'contains forbidden <text',
    'href is not allowed',
    'outside the safe circle',
    'needs exactly four vertical tally strokes',
    'chunks other than IHDR/IDAT/IEND: tEXt',
    'logo/ SVG list differs',
    'README.md Files table lacks',
  ];
  const missing = expected.filter((e) => !out.includes(e));
  const fails = (out.match(/^FAIL /gm) ?? []).length;
  if (run.status !== 1 || missing.length) {
    console.error(
      `FAIL self-test: broken fixture exited ${run.status}; not reported: ${missing.join(' | ') || 'none'}`,
    );
    process.exit(1);
  }
  console.log(
    `self-test: broken fixture exited 1 with ${fails} FAIL lines; all ${expected.length} planted defects reported`,
  );
}
