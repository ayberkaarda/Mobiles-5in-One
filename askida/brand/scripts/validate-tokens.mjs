// Validates askida/brand: palette, schemes, WCAG contrast, type, spacing, fonts, logo assets.
// Node only, no dependencies. Usage: node askida/brand/scripts/validate-tokens.mjs
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokens = JSON.parse(readFileSync(join(root, "tokens.json"), "utf8"));
const errors = [];
const fail = (msg) => errors.push(msg);
const HEX6 = /^#[0-9A-F]{6}$/;
const HEX8 = /^#[0-9A-F]{8}$/;

// ---------- palette ----------
const spec = {
  ekmekKabugu: "#C8763A",
  zeytin: "#4E6B3A",
  unBeyazi: "#FBF8F3",
  komur: "#2B2B2B",
  gunBatimi: "#E9A23B",
  deniz: "#2C6E91",
  nar: "#B23A48",
};
const palette = tokens.color.palette;
for (const [k, v] of Object.entries(spec)) {
  if (palette[k]?.value !== v)
    fail(`palette.${k} must be ${v} (spec section 2)`);
  if (palette[k] && palette[k].derived !== false)
    fail(`palette.${k} is a core colour: derived must be false`);
}
const paletteByValue = new Map();
for (const [k, p] of Object.entries(palette)) {
  if (!HEX6.test(p.value) && !HEX8.test(p.value))
    fail(`palette.${k} ${p.value} is not #RRGGBB or #RRGGBBAA (upper case)`);
  if (typeof p.derived !== "boolean")
    fail(`palette.${k} needs derived: true|false`);
  if (!spec[k] && p.derived !== true)
    fail(`palette.${k} is outside the spec palette: derived must be true`);
  if (paletteByValue.has(p.value))
    fail(`palette.${k} duplicates ${paletteByValue.get(p.value)}`);
  paletteByValue.set(p.value, k);
}

// ---------- schemes: parity, required roles, palette membership ----------
const required = [
  "background",
  "surface",
  "surfaceRaised",
  "surfaceSunken",
  "text",
  "textMuted",
  "border",
  "borderStrong",
  "primary",
  "onPrimary",
  "primaryText",
  "secondary",
  "onSecondary",
  "accent",
  "onAccent",
  "info",
  "danger",
  "dangerText",
  "onDanger",
  "success",
  "warning",
  "focusRing",
  "overlay",
  "paper",
  "onPaper",
  "wood",
  "onWood",
];
const schemes = tokens.color.scheme;
const schemeNames = tokens.contrast.schemes;
const roleSets = schemeNames.map((s) =>
  Object.keys(schemes[s] ?? {})
    .sort()
    .join(","),
);
if (new Set(roleSets).size !== 1)
  fail(`role names differ between schemes: ${schemeNames.join(" vs ")}`);
for (const s of schemeNames) {
  const sc = schemes[s];
  if (!sc) {
    fail(`missing scheme ${s}`);
    continue;
  }
  for (const r of required) if (!(r in sc)) fail(`${s}.${r} missing`);
  for (const [r, v] of Object.entries(sc)) {
    const ok = r === "overlay" ? HEX8.test(v) : HEX6.test(v);
    if (!ok) fail(`${s}.${r} ${v} has the wrong hex form`);
    if (!paletteByValue.has(v))
      fail(`${s}.${r} ${v} is not declared in color.palette`);
  }
}

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
const lowest = {};
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
      const key = `${s} ${kind}`;
      if (!lowest[key] || r < lowest[key].r) lowest[key] = { r, line };
      if (r < min) fail(`${line} (< ${min})`);
      else console.log(`ok   ${line}`);
    }
  }
};
check("text", tokens.contrast.textMinimum, tokens.contrast.textPairs);
check("nontext", tokens.contrast.nonTextMinimum, tokens.contrast.nonTextPairs);
if (tokens.contrast.textMinimum < 4.5)
  fail("textMinimum must be at least 4.5 (WCAG AA)");
if (tokens.contrast.nonTextMinimum < 3)
  fail("nonTextMinimum must be at least 3 (WCAG AA non-text)");
for (const n of tokens.color.notValidForText) {
  const r = ratio(n.foreground, n.background);
  if (r >= tokens.contrast.textMinimum)
    fail(
      `notValidForText ${n.foreground}/${n.background} actually passes (${r.toFixed(2)})`,
    );
  else
    console.log(
      `doc  not for text: ${n.foreground} on ${n.background} = ${r.toFixed(2)}`,
    );
}

// ---------- typography ----------
const typo = tokens.typography;
const shipped = new Set(typo.fonts.map((f) => `${f.family}:${f.weight}`));
for (const [name, s] of Object.entries(typo.scale)) {
  const family = typo.fontFamily[s.family];
  if (!family) fail(`type.${name}: unknown family key ${s.family}`);
  else if (!shipped.has(`${family}:${s.weight}`))
    fail(`type.${name}: ${family} ${s.weight} is not a shipped font file`);
  if (s.lineHeight < s.size) fail(`type.${name}: lineHeight < size`);
  if (s.size < 12) fail(`type.${name}: size below 12`);
}

// ---------- spacing, radius, motion, elevation ----------
for (const [name, v] of Object.entries(tokens.spacing)) {
  if (!Number.isInteger(v) || v % 4 !== 0)
    fail(`spacing.${name}=${v} is off the 4-pt grid`);
}
for (const [name, v] of Object.entries(tokens.radius)) {
  if (!Number.isInteger(v) || v < 0)
    fail(`radius.${name} must be a non-negative integer`);
}
for (const [name, v] of Object.entries(tokens.motion.duration)) {
  if (!Number.isInteger(v) || v < 0 || v > 1000)
    fail(`motion.duration.${name}=${v} out of range`);
}
for (const [name, v] of Object.entries(tokens.motion.easing)) {
  if (
    !Array.isArray(v) ||
    v.length !== 4 ||
    v.some((n) => typeof n !== "number")
  )
    fail(`motion.easing.${name} must be 4 numbers`);
}
for (const s of schemeNames) {
  for (const [lvl, e] of Object.entries(tokens.elevation[s] ?? {})) {
    if (!HEX8.test(e.color))
      fail(`elevation.${s}.${lvl}.color must be #RRGGBBAA`);
  }
}

// ---------- fonts: presence, weight, Turkish glyphs (TrueType cmap parse) ----------
const readFont = (buf) => {
  const tables = {};
  const n = buf.readUInt16BE(4);
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    tables[buf.toString("latin1", o, o + 4)] = buf.readUInt32BE(o + 8);
  }
  const cmapAt = tables.cmap;
  const codepoints = new Set();
  const subtables = buf.readUInt16BE(cmapAt + 2);
  for (let i = 0; i < subtables; i++) {
    const rec = cmapAt + 4 + i * 8;
    const platform = buf.readUInt16BE(rec);
    const st = cmapAt + buf.readUInt32BE(rec + 4);
    const format = buf.readUInt16BE(st);
    if (platform !== 3 && platform !== 0) continue;
    if (format === 4) {
      const segX2 = buf.readUInt16BE(st + 6);
      const ends = st + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const offsets = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = buf.readUInt16BE(ends + s * 2);
        const start = buf.readUInt16BE(starts + s * 2);
        const delta = buf.readInt16BE(deltas + s * 2);
        const roAt = offsets + s * 2;
        const ro = buf.readUInt16BE(roAt);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          const gid =
            ro === 0
              ? (c + delta) & 0xffff
              : buf.readUInt16BE(roAt + ro + (c - start) * 2);
          if (gid !== 0) codepoints.add(c);
        }
      }
    } else if (format === 12) {
      const groups = buf.readUInt32BE(st + 12);
      for (let g = 0; g < groups; g++) {
        const o = st + 16 + g * 12;
        const start = buf.readUInt32BE(o);
        const end = buf.readUInt32BE(o + 4);
        for (let c = start; c <= end; c++) codepoints.add(c);
      }
    }
  }
  const weight = tables["OS/2"] ? buf.readUInt16BE(tables["OS/2"] + 4) : null;
  return { codepoints, weight, variable: "fvar" in tables };
};
for (const f of typo.fonts) {
  const p = join(root, f.file);
  if (!existsSync(p)) {
    fail(`missing font ${f.file}`);
    continue;
  }
  const font = readFont(readFileSync(p));
  const missing = [...typo.requiredGlyphs].filter(
    (ch) => !font.codepoints.has(ch.codePointAt(0)),
  );
  if (missing.length) fail(`${f.file} lacks glyphs: ${missing.join(" ")}`);
  if (font.weight !== f.weight)
    fail(`${f.file} OS/2 weight ${font.weight} != ${f.weight}`);
  console.log(
    `font ${f.file}: weight ${font.weight}, ${font.codepoints.size} code points, ${typo.requiredGlyphs} ${missing.length ? "MISSING" : "present"}`,
  );
}

// ---------- assets ----------
const { logo, raster, licences } = tokens.assets;
for (const a of [...logo, ...raster, ...licences])
  if (!existsSync(join(root, a))) fail(`missing asset ${a}`);

// SVG: one <svg> root, balanced tags, viewBox, no raster/external/script/text/comments/metadata.
const checkSvg = (file) => {
  const s = readFileSync(join(root, file), "utf8");
  if (!s.startsWith("<svg ") || !s.trimEnd().endsWith("</svg>"))
    return fail(`${file}: must start with <svg and end with </svg>`);
  if (!/^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(s))
    fail(`${file}: missing svg xmlns`);
  if (!/^<svg [^>]*viewBox="[-\d. ]+"/.test(s))
    fail(`${file}: missing viewBox`);
  for (const bad of [
    "<image",
    "<script",
    "<text",
    "<!--",
    "<metadata",
    "href=",
    "<foreignObject",
    "<?xml",
  ]) {
    if (s.includes(bad)) fail(`${file}: contains forbidden ${bad}`);
  }
  const stack = [];
  const tag = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g;
  let m;
  let roots = 0;
  while ((m = tag.exec(s))) {
    const [, close, name, attrs, selfClose] = m;
    if ((attrs.match(/"/g) ?? []).length % 2)
      fail(`${file}: unbalanced quotes in <${name}>`);
    if (close) {
      if (stack.pop() !== name) return fail(`${file}: mismatched </${name}>`);
    } else if (!selfClose) {
      if (stack.length === 0) roots++;
      stack.push(name);
    } else if (stack.length === 0) roots++;
  }
  if (stack.length) fail(`${file}: unclosed <${stack.join(">, <")}>`);
  if (roots !== 1)
    fail(`${file}: expected exactly one root element, found ${roots}`);
};
for (const f of logo) if (existsSync(join(root, f))) checkSvg(f);

// PNG: signature, 1024x1024, no text metadata chunks.
for (const f of raster) {
  const p = join(root, f);
  if (!existsSync(p)) continue;
  const b = readFileSync(p);
  if (b.readUInt32BE(0) !== 0x89504e47) {
    fail(`${f}: not a PNG`);
    continue;
  }
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  if (w !== 1024 || h !== 1024) fail(`${f}: expected 1024x1024, got ${w}x${h}`);
  for (let o = 8; o < b.length;) {
    const len = b.readUInt32BE(o);
    const type = b.toString("latin1", o + 4, o + 8);
    if (["tEXt", "iTXt", "zTXt", "eXIf"].includes(type))
      fail(`${f}: carries a ${type} metadata chunk`);
    o += 12 + len;
  }
}

// ---------- result ----------
for (const k of Object.keys(lowest).sort())
  console.log(`lowest ${k}: ${lowest[k].line.replace(/^\S+\s+\S+\s+/, "")}`);
if (errors.length) {
  console.error(errors.map((e) => `FAIL ${e}`).join("\n"));
  process.exit(1);
}
console.log("askida brand tokens and assets valid");
