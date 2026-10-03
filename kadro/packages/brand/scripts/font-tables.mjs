// Minimal reader for the font tables the brand checks need (cmap, GSUB features, fvar axes,
// OS/2 weight, PostScript name) from TrueType (.ttf) and WOFF2 (.woff2) files. No dependencies:
// WOFF2 table data is one Brotli stream, which node:zlib decompresses.
import { brotliDecompressSync } from 'node:zlib';

const WOFF2_KNOWN_TAGS = [
  'cmap',
  'head',
  'hhea',
  'hmtx',
  'maxp',
  'name',
  'OS/2',
  'post',
  'cvt ',
  'fpgm',
  'glyf',
  'loca',
  'prep',
  'CFF ',
  'VORG',
  'EBDT',
  'EBLC',
  'gasp',
  'hdmx',
  'kern',
  'LTSH',
  'PCLT',
  'VDMX',
  'vhea',
  'vmtx',
  'BASE',
  'GDEF',
  'GPOS',
  'GSUB',
  'EBSC',
  'JSTF',
  'MATH',
  'CBDT',
  'CBLC',
  'COLR',
  'CPAL',
  'SVG ',
  'sbix',
  'acnt',
  'avar',
  'bdat',
  'bloc',
  'bsln',
  'cvar',
  'fdsc',
  'feat',
  'fmtx',
  'fvar',
  'gvar',
  'hsty',
  'just',
  'lcar',
  'mort',
  'morx',
  'opbd',
  'prop',
  'trak',
  'Zapf',
  'Silf',
  'Glat',
  'Gloc',
  'Feat',
  'Sill',
];

const tagAt = (buf, offset) => buf.toString('latin1', offset, offset + 4);

function readBase128(buf, state) {
  let value = 0;
  for (let i = 0; i < 5; i += 1) {
    const byte = buf.readUInt8(state.offset);
    state.offset += 1;
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return value;
  }
  throw new Error('invalid UIntBase128');
}

/** Table tag -> Buffer for a .ttf or .woff2 file (WOFF2 transformed tables are not decoded). */
export function readTables(buf) {
  const tables = new Map();
  const signature = tagAt(buf, 0);
  if (signature === 'wOF2') {
    const numTables = buf.readUInt16BE(12);
    const compressedSize = buf.readUInt32BE(20);
    const state = { offset: 48 };
    const entries = [];
    for (let i = 0; i < numTables; i += 1) {
      const flags = buf.readUInt8(state.offset);
      state.offset += 1;
      let tag = WOFF2_KNOWN_TAGS[flags & 0x3f];
      if ((flags & 0x3f) === 63) {
        tag = tagAt(buf, state.offset);
        state.offset += 4;
      }
      const version = flags >> 6;
      const origLength = readBase128(buf, state);
      const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
      const length = transformed ? readBase128(buf, state) : origLength;
      entries.push({ tag, length, transformed });
    }
    const data = brotliDecompressSync(buf.subarray(state.offset, state.offset + compressedSize));
    let cursor = 0;
    for (const entry of entries) {
      if (!entry.transformed) tables.set(entry.tag, data.subarray(cursor, cursor + entry.length));
      cursor += entry.length;
    }
    return tables;
  }
  const numTables = buf.readUInt16BE(4);
  for (let i = 0; i < numTables; i += 1) {
    const record = 12 + i * 16;
    const offset = buf.readUInt32BE(record + 8);
    const length = buf.readUInt32BE(record + 12);
    tables.set(tagAt(buf, record), buf.subarray(offset, offset + length));
  }
  return tables;
}

/** Whether the best Unicode cmap subtable maps `codePoint` to a glyph other than .notdef. */
function cmapLookup(cmap, codePoint) {
  const count = cmap.readUInt16BE(2);
  const subtables = [];
  for (let i = 0; i < count; i += 1) {
    const record = 4 + i * 8;
    subtables.push({
      platform: cmap.readUInt16BE(record),
      encoding: cmap.readUInt16BE(record + 2),
      offset: cmap.readUInt32BE(record + 4),
    });
  }
  const pick =
    subtables.find((s) => s.platform === 3 && s.encoding === 10) ??
    subtables.find((s) => s.platform === 0 && s.encoding === 4) ??
    subtables.find((s) => s.platform === 3 && s.encoding === 1) ??
    subtables.find((s) => s.platform === 0);
  if (!pick) return false;
  const t = cmap.subarray(pick.offset);
  const format = t.readUInt16BE(0);
  if (format === 12) {
    const groups = t.readUInt32BE(12);
    for (let i = 0; i < groups; i += 1) {
      const g = 16 + i * 12;
      const start = t.readUInt32BE(g);
      const end = t.readUInt32BE(g + 4);
      if (codePoint >= start && codePoint <= end)
        return t.readUInt32BE(g + 8) + codePoint - start !== 0;
    }
    return false;
  }
  if (format === 4) {
    const segCount = t.readUInt16BE(6) / 2;
    const ends = 14;
    const starts = ends + segCount * 2 + 2;
    const deltas = starts + segCount * 2;
    const rangeOffsets = deltas + segCount * 2;
    for (let i = 0; i < segCount; i += 1) {
      const end = t.readUInt16BE(ends + i * 2);
      if (codePoint > end) continue;
      const start = t.readUInt16BE(starts + i * 2);
      if (codePoint < start) return false;
      const delta = t.readUInt16BE(deltas + i * 2);
      const rangeOffset = t.readUInt16BE(rangeOffsets + i * 2);
      if (rangeOffset === 0) return ((codePoint + delta) & 0xffff) !== 0;
      const at = rangeOffsets + i * 2 + rangeOffset + (codePoint - start) * 2;
      const glyph = t.readUInt16BE(at);
      return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0;
    }
    return false;
  }
  throw new Error(`unsupported cmap format ${format}`);
}

function features(gsub) {
  if (!gsub) return [];
  const list = gsub.readUInt16BE(6);
  const count = gsub.readUInt16BE(list);
  const tags = new Set();
  for (let i = 0; i < count; i += 1) tags.add(tagAt(gsub, list + 2 + i * 6));
  return [...tags].sort();
}

function axes(fvar) {
  if (!fvar) return [];
  const offset = fvar.readUInt16BE(4);
  const count = fvar.readUInt16BE(8);
  const size = fvar.readUInt16BE(10);
  const fixed = (at) => fvar.readInt32BE(at) / 65536;
  return Array.from({ length: count }, (_, i) => {
    const a = offset + i * size;
    return { tag: tagAt(fvar, a), min: fixed(a + 4), default: fixed(a + 8), max: fixed(a + 12) };
  });
}

function postScriptName(name) {
  if (!name) return undefined;
  const count = name.readUInt16BE(2);
  const strings = name.readUInt16BE(4);
  for (let i = 0; i < count; i += 1) {
    const r = 6 + i * 12;
    if (name.readUInt16BE(r) !== 3 || name.readUInt16BE(r + 6) !== 6) continue;
    const length = name.readUInt16BE(r + 8);
    const start = strings + name.readUInt16BE(r + 10);
    const bytes = Buffer.from(name.subarray(start, start + length));
    return bytes.swap16().toString('utf16le');
  }
  return undefined;
}

/** Summary of one font file for the brand checks. */
export function inspectFont(buf) {
  const tables = readTables(buf);
  const cmap = tables.get('cmap');
  const os2 = tables.get('OS/2');
  return {
    tables: [...tables.keys()].sort(),
    hasGlyph: (codePoint) => (cmap ? cmapLookup(cmap, codePoint) : false),
    features: features(tables.get('GSUB')),
    axes: axes(tables.get('fvar')),
    weightClass: os2 ? os2.readUInt16BE(4) : undefined,
    postScriptName: postScriptName(tables.get('name')),
  };
}
