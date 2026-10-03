/* eslint-disable security/detect-object-injection -- indices are loop counters over fixed-size arrays and module grids */
/**
 * QR Code Model 2 encoder (ISO/IEC 18004) for the TOTP enrollment URI of the admin panel
 * (ADR-0068). Byte mode, error correction level M, the smallest version that fits, and the mask
 * with the lowest penalty score. It runs in the browser on the enrollment response, so the secret
 * never reaches a third-party QR service or a server-rendered page. No dependencies.
 */

/** Error correction codewords per block for level M, indexed by version (index 0 unused). */
const ECC_CODEWORDS_PER_BLOCK_M: readonly number[] = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];

/** Error correction blocks for level M, indexed by version (index 0 unused). */
const ECC_BLOCKS_M: readonly number[] = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25,
  26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];

/** Format-information bits of level M (L = 1, M = 0, Q = 3, H = 2). */
const ECC_FORMAT_BITS_M = 0;

export const QR_MIN_VERSION = 1;
export const QR_MAX_VERSION = 40;

export interface QrMatrix {
  readonly version: number;
  readonly mask: number;
  /** Modules per side (`4 * version + 17`), without the quiet zone. */
  readonly size: number;
  /** `modules[y][x]`, `true` for a dark module. */
  readonly modules: readonly (readonly boolean[])[];
}

function bit(value: number, index: number): boolean {
  return ((value >>> index) & 1) !== 0;
}

/** GF(2^8) multiplication modulo the QR polynomial x^8 + x^4 + x^3 + x^2 + 1. */
function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** Coefficients of the Reed-Solomon generator polynomial of `degree`, highest term dropped. */
export function reedSolomonDivisor(degree: number): number[] {
  const result: number[] = Array.from({ length: degree }, () => 0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      const next = j + 1 < result.length ? (result[j + 1] ?? 0) : 0;
      result[j] = gfMultiply(result[j] ?? 0, root) ^ next;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

/** Error correction codewords of `data` for the generator `divisor`. */
export function reedSolomonRemainder(
  data: readonly number[],
  divisor: readonly number[],
): number[] {
  const result: number[] = divisor.map(() => 0);
  for (const value of data) {
    const factor = value ^ (result.shift() ?? 0);
    result.push(0);
    for (let i = 0; i < divisor.length; i += 1) {
      result[i] = (result[i] ?? 0) ^ gfMultiply(divisor[i] ?? 0, factor);
    }
  }
  return result;
}

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignments = Math.floor(version / 7) + 2;
    result -= (25 * alignments - 10) * alignments - 55;
    if (version >= 7) {
      result -= 36;
    }
  }
  return result;
}

function dataCodewords(version: number): number {
  return (
    Math.floor(rawDataModules(version) / 8) -
    (ECC_CODEWORDS_PER_BLOCK_M[version] ?? 0) * (ECC_BLOCKS_M[version] ?? 0)
  );
}

function countBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

/** Bits needed for `byteLength` bytes in byte mode, or `null` when the count field overflows. */
function payloadBits(version: number, byteLength: number): number | null {
  const count = countBits(version);
  return byteLength >= 2 ** count ? null : 4 + count + 8 * byteLength;
}

/** The smallest version whose level-M capacity holds `byteLength` bytes, or `null`. */
export function versionFor(byteLength: number): number | null {
  for (let version = QR_MIN_VERSION; version <= QR_MAX_VERSION; version += 1) {
    const needed = payloadBits(version, byteLength);
    if (needed !== null && needed <= dataCodewords(version) * 8) {
      return version;
    }
  }
  return null;
}

/** Data codewords: mode, count, bytes, terminator, bit padding and the 0xEC/0x11 pad bytes. */
function encodeData(bytes: Uint8Array, version: number): number[] {
  const bits: boolean[] = [];
  const append = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) {
      bits.push(bit(value, i));
    }
  };
  append(0b0100, 4);
  append(bytes.length, countBits(version));
  for (const value of bytes) {
    append(value, 8);
  }
  const capacity = dataCodewords(version) * 8;
  append(0, Math.min(4, capacity - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) {
      value = (value << 1) | (bits[i + j] === true ? 1 : 0);
    }
    codewords.push(value);
  }
  for (let pad = 0xec; codewords.length < capacity / 8; pad ^= 0xec ^ 0x11) {
    codewords.push(pad);
  }
  return codewords;
}

/** Splits the data into blocks, appends each block's ECC and interleaves the result. */
function withErrorCorrection(data: readonly number[], version: number): number[] {
  const blockCount = ECC_BLOCKS_M[version] ?? 1;
  const eccLength = ECC_CODEWORDS_PER_BLOCK_M[version] ?? 0;
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blockCount - (rawCodewords % blockCount);
  const shortBlockLength = Math.floor(rawCodewords / blockCount);
  const divisor = reedSolomonDivisor(eccLength);
  const blocks: number[][] = [];
  let offset = 0;
  for (let i = 0; i < blockCount; i += 1) {
    const length = shortBlockLength - eccLength + (i < shortBlocks ? 0 : 1);
    const block = data.slice(offset, offset + length);
    offset += length;
    const ecc = reedSolomonRemainder(block, divisor);
    if (i < shortBlocks) {
      block.push(0);
    }
    blocks.push([...block, ...ecc]);
  }
  const result: number[] = [];
  const width = blocks[0]?.length ?? 0;
  for (let i = 0; i < width; i += 1) {
    blocks.forEach((block, j) => {
      // The padding byte of a short block is not transmitted.
      if (i !== shortBlockLength - eccLength || j >= shortBlocks) {
        result.push(block[i] ?? 0);
      }
    });
  }
  return result;
}

export function alignmentPositions(version: number): number[] {
  if (version === 1) {
    return [];
  }
  const size = version * 4 + 17;
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let position = size - 7; result.length < count; position -= step) {
    result.splice(1, 0, position);
  }
  return result;
}

/** 15 format bits (level M, `mask`) with their BCH code and the fixed XOR mask. */
export function formatBits(mask: number): number {
  const data = (ECC_FORMAT_BITS_M << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

/** 18 version bits with their BCH code (versions 7 and above). */
export function versionBits(version: number): number {
  let remainder = version;
  for (let i = 0; i < 12; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  }
  return (version << 12) | remainder;
}

function maskApplies(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

class Grid {
  readonly size: number;
  readonly modules: boolean[][];
  readonly reserved: boolean[][];

  constructor(size: number) {
    this.size = size;
    this.modules = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
    this.reserved = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  }

  get(x: number, y: number): boolean {
    return this.modules[y]?.[x] === true;
  }

  setFunction(x: number, y: number, dark: boolean): void {
    const row = this.modules[y];
    const reservedRow = this.reserved[y];
    if (row !== undefined && reservedRow !== undefined && x >= 0 && x < this.size) {
      row[x] = dark;
      reservedRow[x] = true;
    }
  }

  isFunction(x: number, y: number): boolean {
    return this.reserved[y]?.[x] === true;
  }

  flip(x: number, y: number): void {
    const row = this.modules[y];
    if (row !== undefined) {
      row[x] = row[x] !== true;
    }
  }
}

function drawFinder(grid: Grid, cx: number, cy: number): void {
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      const x = cx + dx;
      const y = cy + dy;
      if (x >= 0 && x < grid.size && y >= 0 && y < grid.size) {
        grid.setFunction(x, y, distance !== 2 && distance !== 4);
      }
    }
  }
}

function drawAlignment(grid: Grid, cx: number, cy: number): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      grid.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

function drawFormat(grid: Grid, mask: number): void {
  const bits = formatBits(mask);
  const size = grid.size;
  for (let i = 0; i <= 5; i += 1) {
    grid.setFunction(8, i, bit(bits, i));
  }
  grid.setFunction(8, 7, bit(bits, 6));
  grid.setFunction(8, 8, bit(bits, 7));
  grid.setFunction(7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i += 1) {
    grid.setFunction(14 - i, 8, bit(bits, i));
  }
  for (let i = 0; i < 8; i += 1) {
    grid.setFunction(size - 1 - i, 8, bit(bits, i));
  }
  for (let i = 8; i < 15; i += 1) {
    grid.setFunction(8, size - 15 + i, bit(bits, i));
  }
  // The dark module.
  grid.setFunction(8, size - 8, true);
}

function drawFunctionPatterns(grid: Grid, version: number): void {
  const size = grid.size;
  for (let i = 0; i < size; i += 1) {
    grid.setFunction(6, i, i % 2 === 0);
    grid.setFunction(i, 6, i % 2 === 0);
  }
  drawFinder(grid, 3, 3);
  drawFinder(grid, size - 4, 3);
  drawFinder(grid, 3, size - 4);
  const positions = alignmentPositions(version);
  const last = positions.length - 1;
  positions.forEach((x, i) => {
    positions.forEach((y, j) => {
      const nearFinder = (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
      if (!nearFinder) {
        drawAlignment(grid, x, y);
      }
    });
  });
  // Reserve the format areas now; the real bits are drawn once the mask is chosen.
  drawFormat(grid, 0);
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i += 1) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      grid.setFunction(a, b, bit(bits, i));
      grid.setFunction(b, a, bit(bits, i));
    }
  }
}

function drawCodewords(grid: Grid, codewords: readonly number[]): void {
  const size = grid.size;
  const totalBits = codewords.length * 8;
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) {
      right = 5;
    }
    const upward = ((right + 1) & 2) === 0;
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const y = upward ? size - 1 - vertical : vertical;
        if (!grid.isFunction(x, y) && index < totalBits) {
          const dark = bit(codewords[index >>> 3] ?? 0, 7 - (index & 7));
          if (dark) {
            grid.flip(x, y);
          }
          index += 1;
        }
      }
    }
  }
}

function applyMask(grid: Grid, mask: number): void {
  for (let y = 0; y < grid.size; y += 1) {
    for (let x = 0; x < grid.size; x += 1) {
      if (!grid.isFunction(x, y) && maskApplies(mask, x, y)) {
        grid.flip(x, y);
      }
    }
  }
}

const FINDER_LIKE = [true, false, true, true, true, false, true, false, false, false, false];
const FINDER_LIKE_REVERSED = [...FINDER_LIKE].reverse();

function lineMatches(
  line: readonly boolean[],
  start: number,
  pattern: readonly boolean[],
): boolean {
  return pattern.every((value, offset) => line[start + offset] === value);
}

/** Penalty score of ISO/IEC 18004 §7.8.3 (rules N1 to N4); lower scans more reliably. */
export function penaltyScore(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length;
  const lines: boolean[][] = [];
  for (let i = 0; i < size; i += 1) {
    lines.push([...(modules[i] ?? [])]);
    lines.push(modules.map((row) => row[i] === true));
  }
  let score = 0;
  for (const line of lines) {
    // N1: runs of five or more same-colored modules.
    let run = 1;
    for (let i = 1; i <= line.length; i += 1) {
      if (i < line.length && line[i] === line[i - 1]) {
        run += 1;
      } else {
        if (run >= 5) {
          score += 3 + (run - 5);
        }
        run = 1;
      }
    }
    // N3: finder-like 1:1:3:1:1 patterns with four light modules on one side.
    for (let i = 0; i + FINDER_LIKE.length <= line.length; i += 1) {
      if (lineMatches(line, i, FINDER_LIKE) || lineMatches(line, i, FINDER_LIKE_REVERSED)) {
        score += 40;
      }
    }
  }
  // N2: 2x2 blocks of one color.
  let dark = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = modules[y]?.[x] === true;
      if (value) {
        dark += 1;
      }
      if (
        x + 1 < size &&
        y + 1 < size &&
        modules[y]?.[x + 1] === value &&
        modules[y + 1]?.[x] === value &&
        modules[y + 1]?.[x + 1] === value
      ) {
        score += 3;
      }
    }
  }
  // N4: deviation of the dark share from 50 %, 10 points per 5 % step.
  const total = size * size;
  const steps = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  return score + Math.max(0, steps) * 10;
}

/**
 * Encodes `text` (UTF-8, byte mode, level M). Throws `RangeError` when it does not fit version 40;
 * the enrollment URI is at most 512 characters, which version 18 holds.
 */
export function encodeQr(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  const version = versionFor(bytes.length);
  if (version === null) {
    throw new RangeError('text does not fit in a QR code');
  }
  const codewords = withErrorCorrection(encodeData(bytes, version), version);
  const size = version * 4 + 17;
  const grid = new Grid(size);
  drawFunctionPatterns(grid, version);
  drawCodewords(grid, codewords);

  let bestMask = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    applyMask(grid, mask);
    drawFormat(grid, mask);
    const score = penaltyScore(grid.modules);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
    }
    // Masking is an XOR, so applying it again restores the unmasked data.
    applyMask(grid, mask);
  }
  applyMask(grid, bestMask);
  drawFormat(grid, bestMask);
  return {
    version,
    mask: bestMask,
    size,
    modules: grid.modules.map((row) => [...row]),
  };
}

/**
 * SVG path data drawing every dark module as a unit square, offset by `quietZone` modules, for a
 * `viewBox` of `size + 2 * quietZone` units. Rendered as one `<path>` element (no markup string).
 */
export function qrPathData(matrix: QrMatrix, quietZone = 4): string {
  const parts: string[] = [];
  matrix.modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) {
        parts.push(`M${x + quietZone} ${y + quietZone}h1v1h-1z`);
      }
    });
  });
  return parts.join('');
}
