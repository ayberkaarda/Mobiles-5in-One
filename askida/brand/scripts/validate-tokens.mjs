// Validates askida/brand v2 ("rail, not hands"): palette, schemes, WCAG contrast,
// documented failures, typography, spacing, radius, stroke, elevation, motion.
// Node only, no dependencies. Usage: node askida/brand/scripts/validate-tokens.mjs [brandDir]
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { brotliDecompressSync } from "node:zlib";

const root = process.argv[2]
  ? resolve(process.argv[2])
  : join(dirname(fileURLToPath(import.meta.url)), "..");
const tokens = JSON.parse(readFileSync(join(root, "tokens.json"), "utf8"));
const errors = [];
const fail = (msg) => errors.push(msg);
const HEX6 = /^#[0-9A-F]{6}$/;
const HEX8 = /^#[0-9A-F]{8}$/;

if (!/^2\.\d+\.\d+$/.test(tokens.version)) fail("tokens.version must be 2.x");

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
  "accentText",
  "info",
  "success",
  "warning",
  "danger",
  "dangerText",
  "onDanger",
  "focusRing",
  "overlay",
];
const retired = ["paper", "onPaper", "wood", "onWood"];
const schemes = tokens.color.scheme;
const schemeNames = tokens.contrast.schemes;
const roleSets = schemeNames.map((s) =>
  Object.keys(schemes[s] ?? {})
    .sort()
    .join(","),
);
if (new Set(roleSets).size !== 1)
  fail(`role names differ between schemes: ${schemeNames.join(" vs ")}`);
if (tokens.color.craft) fail("color.craft is retired in v2");
if (tokens.contrast.textureCeiling !== undefined)
  fail("contrast.textureCeiling is retired in v2");
for (const s of schemeNames) {
  const sc = schemes[s];
  if (!sc) {
    fail(`missing scheme ${s}`);
    continue;
  }
  for (const r of required) if (!(r in sc)) fail(`${s}.${r} missing`);
  for (const r of retired) if (r in sc) fail(`${s}.${r} is retired in v2`);
  for (const [r, v] of Object.entries(sc)) {
    const ok = r === "overlay" ? HEX8.test(v) : HEX6.test(v);
    if (!ok) fail(`${s}.${r} ${v} has the wrong hex form`);
    if (!paletteByValue.has(v))
      fail(`${s}.${r} ${v} is not declared in color.palette`);
  }
  // Guardrail 8.2: accent is never a button, surface or text role.
  const accent = sc.accent;
  for (const r of [
    "primary",
    "secondary",
    "danger",
    "background",
    "surface",
    "surfaceRaised",
    "surfaceSunken",
    "text",
    "textMuted",
    "primaryText",
  ]) {
    if (sc[r] === accent) fail(`${s}.${r} must not use the accent colour`);
  }
  // Primary is ink: equal to text, and primaryText equals text.
  if (sc.primary !== sc.text)
    fail(`${s}.primary must equal ${s}.text (ink buttons)`);
  if (sc.primaryText !== sc.text) fail(`${s}.primaryText must equal ${s}.text`);
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
if (tokens.contrast.textMinimum < 4.5)
  fail("textMinimum must be at least 4.5 (WCAG AA)");
if (tokens.contrast.nonTextMinimum < 3)
  fail("nonTextMinimum must be at least 3 (WCAG AA non-text)");
check("text", tokens.contrast.textMinimum, tokens.contrast.pairs);
check("nontext", tokens.contrast.nonTextMinimum, tokens.contrast.nonTextPairs);
const surfaces = ["background", "surface", "surfaceRaised", "surfaceSunken"];
for (const t of [
  "text",
  "textMuted",
  "primaryText",
  "accentText",
  "info",
  "success",
  "warning",
  "dangerText",
]) {
  for (const sf of surfaces) {
    if (!tokens.contrast.pairs.some(([a, b]) => a === t && b === sf))
      fail(`contrast.pairs lacks ${t}/${sf}`);
  }
}
for (const [on, fill] of [
  ["onPrimary", "primary"],
  ["onSecondary", "secondary"],
  ["onAccent", "accent"],
  ["onDanger", "danger"],
]) {
  if (!tokens.contrast.pairs.some(([a, b]) => a === on && b === fill))
    fail(`contrast.pairs lacks ${on}/${fill}`);
}
if (tokens.contrast.nonTextPairs.some(([a]) => a === "secondary"))
  fail("secondary is a quiet fill: no non-text pair");
for (const n of tokens.contrast.notValidForText) {
  const r = ratio(
    schemes[n.scheme][n.foreground],
    schemes[n.scheme][n.background],
  );
  if (r >= tokens.contrast.textMinimum)
    fail(
      `notValidForText ${n.scheme} ${n.foreground}/${n.background} actually passes (${r.toFixed(2)})`,
    );
  else
    console.log(
      `doc  not for text: ${n.scheme} ${n.foreground} on ${n.background} = ${r.toFixed(2)}`,
    );
}
for (const n of tokens.contrast.notValidForFill) {
  const r = ratio(schemes[n.scheme][n.fill], schemes[n.scheme][n.background]);
  if (r >= n.minimum)
    fail(
      `notValidForFill ${n.scheme} ${n.fill}/${n.background} actually passes (${r.toFixed(2)})`,
    );
  else
    console.log(
      `doc  not as fill: ${n.scheme} ${n.fill} on ${n.background} = ${r.toFixed(2)}`,
    );
  if (
    tokens.contrast.nonTextPairs.some(
      ([a, b]) => a === n.fill && b === n.background,
    )
  )
    fail(
      `${n.fill}/${n.background} is documented as invalid but listed as a non-text pair`,
    );
}

// ---------- typography ----------
const typo = tokens.typography;
if (typo.family !== "Bricolage Grotesque")
  fail("typography.family must be Bricolage Grotesque");
if (typo.width !== 100) fail("typography.width is pinned at 100");
for (const [name, s] of Object.entries(typo.scale)) {
  const cut = typo.cuts[s.cut];
  if (!cut) {
    fail(`type.${name}: unknown cut ${s.cut}`);
    continue;
  }
  if (!cut.weights.includes(s.weight))
    fail(`type.${name}: ${s.cut} has no weight ${s.weight}`);
  if (s.weight > typo.maxWeight)
    fail(`type.${name}: weight above ${typo.maxWeight}`);
  for (const ctx of ["app", "web", "webMobile"]) {
    const m = s[ctx];
    if (!m) continue;
    if (m.lineHeight < m.size) fail(`type.${name}.${ctx}: lineHeight < size`);
    if (m.size < 12) fail(`type.${name}.${ctx}: size below 12`);
    if (s.cut === "display" && m.size < typo.cuts.display.minSize)
      fail(
        `type.${name}.${ctx}: Display cut below ${typo.cuts.display.minSize}`,
      );
  }
  const numeric = ["numeral", "numeralXL", "code"].includes(name);
  const hasTnum = (s.features ?? []).includes("tnum");
  if (numeric !== hasTnum)
    fail(`type.${name}: tnum belongs to numeral, numeralXL and code only`);
}
if (typo.scale.body.app.size < 16) fail("body never below 16");

// ---------- spacing, radius, stroke, elevation, motion ----------
for (const [name, v] of Object.entries(tokens.spacing)) {
  if (!Number.isInteger(v) || v % 4 !== 0)
    fail(`spacing.${name}=${v} is off the 4-pt grid`);
}
const radiusSpec = {
  tag: 6,
  chip: 6,
  button: 10,
  input: 10,
  card: 14,
  row: 14,
  sheet: 20,
  dialog: 20,
  avatar: 9999,
};
for (const [k, v] of Object.entries(radiusSpec))
  if (tokens.radius[k] !== v) fail(`radius.${k} must be ${v}`);
if (Object.keys(tokens.radius).length !== Object.keys(radiusSpec).length)
  fail("radius has extra keys");
if (tokens.stroke.rail !== 2 || tokens.stroke.icon !== 1.75)
  fail("stroke.rail must be 2 and stroke.icon 1.75");
const elev = tokens.elevation;
if (Object.keys(elev).some((k) => !["rule", "sheet"].includes(k)))
  fail("elevation: only the sheet shadow exists");
for (const s of schemeNames)
  if (!HEX8.test(elev.sheet[s]?.color ?? ""))
    fail(`elevation.sheet.${s}.color must be #RRGGBBAA`);
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

// ---------- fonts: files, cmap (Turkish + lira), GSUB tnum/lnum + TRK, sizes ----------
const WOFF2_TAGS = (
  "cmap head hhea hmtx maxp name OS/2 post cvt  fpgm glyf loca prep CFF  VORG EBDT EBLC gasp hdmx kern LTSH " +
  "PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG  sbix acnt avar bdat bloc " +
  "bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill"
)
  .match(/.{4}\s?/g)
  .map((t) => t.slice(0, 4));
const base128 = (b, st) => {
  let v = 0;
  for (let i = 0; i < 5; i++) {
    const byte = b[st.o++];
    v = v * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return v;
  }
  throw new Error("bad UIntBase128");
};
// Returns { tag: Buffer } for the tables we need, from a TTF or a WOFF2 file.
const fontTables = (buf) => {
  const out = {};
  const sig = buf.readUInt32BE(0);
  if (sig === 0x774f4632) {
    const numTables = buf.readUInt16BE(12);
    const compressed = buf.readUInt32BE(20);
    const st = { o: 48 };
    const dir = [];
    for (let i = 0; i < numTables; i++) {
      const flags = buf[st.o++];
      let tag = WOFF2_TAGS[flags & 63];
      if ((flags & 63) === 63) {
        tag = buf.toString("latin1", st.o, st.o + 4);
        st.o += 4;
      }
      const version = (flags >> 6) & 3;
      const orig = base128(buf, st);
      const transformed =
        tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
      const length = transformed ? base128(buf, st) : orig;
      dir.push({ tag, length });
    }
    const data = brotliDecompressSync(buf.subarray(st.o, st.o + compressed));
    let o = 0;
    for (const t of dir) {
      out[t.tag] = data.subarray(o, o + t.length);
      o += t.length;
    }
    return out;
  }
  const n = buf.readUInt16BE(4);
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    const tag = buf.toString("latin1", r, r + 4);
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
          const gid =
            ro === 0
              ? (c + delta) & 0xffff
              : t.readUInt16BE(roAt + ro + (c - start) * 2);
          if (gid !== 0) cps.add(c);
        }
      }
    } else if (format === 12) {
      const groups = t.readUInt32BE(st + 12);
      for (let g = 0; g < groups; g++) {
        const o = st + 16 + g * 12;
        for (let c = t.readUInt32BE(o); c <= t.readUInt32BE(o + 4); c++)
          cps.add(c);
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
    for (let j = 0; j < lc; j++)
      langs.add(t.toString("latin1", so + 4 + j * 6, so + 8 + j * 6));
  }
  const feats = new Set();
  const fc = t.readUInt16BE(featureList);
  for (let i = 0; i < fc; i++)
    feats.add(
      t.toString("latin1", featureList + 2 + i * 6, featureList + 6 + i * 6),
    );
  return { langs, feats };
};
const ff = typo.fontFiles;
const fontEntries = [
  { file: ff.source.file, variable: true },
  ...ff.flutter.map((f) => ({ ...f, variable: false })),
  ...ff.web.map((f) => ({ ...f, variable: f.weight === "400 700", web: true })),
];
let webTotal = 0;
if (!existsSync(join(root, ff.source.licence)))
  fail(`missing ${ff.source.licence}`);
for (const f of fontEntries) {
  const p = join(root, f.file);
  if (!existsSync(p)) {
    fail(`missing font ${f.file}`);
    continue;
  }
  const buf = readFileSync(p);
  const kb = buf.length / 1024;
  let t;
  try {
    t = fontTables(buf);
  } catch (e) {
    fail(`${f.file}: cannot parse (${e.message})`);
    continue;
  }
  const cps = cmapOf(t.cmap);
  const missing = [...typo.requiredGlyphs].filter(
    (ch) => !cps.has(ch.codePointAt(0)),
  );
  if (missing.length) fail(`${f.file} lacks glyphs: ${missing.join(" ")}`);
  const { langs, feats } = gsubOf(t.GSUB);
  for (const ft of typo.requiredFeatures)
    if (!feats.has(ft)) fail(`${f.file}: GSUB lacks ${ft}`);
  if (!langs.has("TRK ")) fail(`${f.file}: GSUB lacks the TRK language system`);
  if (Boolean(t.fvar) !== f.variable)
    fail(`${f.file}: expected ${f.variable ? "variable" : "static"} font`);
  if (f.weight && typeof f.weight === "number") {
    const w = t["OS/2"].readUInt16BE(4);
    if (w !== f.weight) fail(`${f.file}: OS/2 weight ${w} != ${f.weight}`);
  }
  if (f.web) {
    if (buf.readUInt32BE(0) !== 0x774f4632) fail(`${f.file}: not a WOFF2 file`);
    webTotal += kb;
    if (f.maxKB && kb > f.maxKB)
      fail(`${f.file}: ${kb.toFixed(1)} KB > ${f.maxKB} KB`);
  }
  console.log(
    `font ${f.file}: ${kb.toFixed(1)} KB, ${cps.size} code points, ${missing.length ? "MISSING glyphs" : "ÇĞİÖŞÜçğıöşü₺ present"}, tnum ${feats.has("tnum")}, lnum ${feats.has("lnum")}, TRK ${langs.has("TRK ")}`,
  );
}
if (webTotal > ff.webTotalMaxKB)
  fail(`web fonts total ${webTotal.toFixed(1)} KB > ${ff.webTotalMaxKB} KB`);
console.log(
  `web fonts total ${webTotal.toFixed(1)} KB (budget ${ff.webTotalMaxKB} KB)`,
);
for (const old of ["fonts/fraunces", "fonts/nunito-sans"]) {
  if (existsSync(join(root, old)))
    fail(`${old} is retired in v2 (one family only)`);
}

// ---------- result ----------
for (const k of Object.keys(results).sort()) {
  const low = results[k].sort((a, b) => a.r - b.r).slice(0, 3);
  console.log(
    `lowest ${k}: ${low.map((x) => x.line.replace(/^\S+\s+\S+\s+/, "")).join(" | ")}`,
  );
}
if (errors.length) {
  console.error(errors.map((e) => `FAIL ${e}`).join("\n"));
  process.exit(1);
}
console.log("askida brand v2 valid");
