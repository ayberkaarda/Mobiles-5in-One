/**
 * A small QR Code Model 2 encoder (ISO/IEC 18004): byte mode, error correction level M,
 * versions 1 to 40, mask chosen by the standard penalty rules. It runs in the browser so the
 * TOTP secret never leaves the page for an external QR service (ADR-0041).
 */

export interface QrMatrix {
  readonly version: number;
  readonly mask: number;
  readonly size: number;
  /** `modules[y][x]`, true for a dark module. */
  readonly modules: readonly (readonly boolean[])[];
}

export interface QrOptions {
  /** Forces a mask 0 to 7; otherwise the lowest penalty wins. */
  mask?: number;
  /** Forces the smallest allowed version; the data must fit. */
  minVersion?: number;
}

// Level M, indexed by version (index 0 unused).
const ECC_PER_BLOCK = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];
const BLOCKS = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25,
  26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];
/** Format bits of level M. */
const LEVEL_M_BITS = 0;
const MAX_BYTES = 2331;

function bit(value: number, index: number): boolean {
  return ((value >>> index) & 1) !== 0;
}

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(version: number): number {
  return (
    Math.floor(rawDataModules(version) / 8) - (ECC_PER_BLOCK[version] ?? 0) * (BLOCKS[version] ?? 0)
  );
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const result = [6];
  for (let position = version * 4 + 10; result.length < count; position -= step) {
    result.splice(1, 0, position);
  }
  return result;
}

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result: number[] = new Array<number>(degree - 1).fill(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j] as number, root);
      if (j + 1 < result.length) result[j] = (result[j] as number) ^ (result[j + 1] as number);
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result: number[] = divisor.map(() => 0);
  for (const value of data) {
    const factor = value ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coefficient, i) => {
      result[i] = (result[i] as number) ^ gfMultiply(coefficient, factor);
    });
  }
  return result;
}

function encodeData(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  bytes.forEach((value) => push(value, 8));
  const capacity = dataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j++) value = (value << 1) | (bits[i + j] as number);
    codewords.push(value);
  }
  for (let pad = 0xec; codewords.length < dataCodewords(version); pad ^= 0xec ^ 0x11) {
    codewords.push(pad);
  }
  return codewords;
}

function interleave(data: readonly number[], version: number): number[] {
  const blockCount = BLOCKS[version] as number;
  const eccLength = ECC_PER_BLOCK[version] as number;
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blockCount - (raw % blockCount);
  const shortLength = Math.floor(raw / blockCount);
  const divisor = rsDivisor(eccLength);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < blockCount; i++) {
    const block = data.slice(k, k + shortLength - eccLength + (i < shortBlocks ? 0 : 1));
    k += block.length;
    const ecc = rsRemainder(block, divisor);
    if (i < shortBlocks) block.push(0);
    blocks.push(block.concat(ecc));
  }
  const result: number[] = [];
  const width = (blocks[0] as number[]).length;
  for (let i = 0; i < width; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLength - eccLength || j >= shortBlocks) result.push(block[i] as number);
    });
  }
  return result;
}

class Grid {
  readonly modules: boolean[][];
  readonly reserved: boolean[][];

  constructor(readonly size: number) {
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }

  fixed(x: number, y: number, dark: boolean): void {
    (this.modules[y] as boolean[])[x] = dark;
    (this.reserved[y] as boolean[])[x] = true;
  }
}

function drawFunctionPatterns(grid: Grid, version: number): void {
  const size = grid.size;
  for (let i = 0; i < size; i++) {
    grid.fixed(6, i, i % 2 === 0);
    grid.fixed(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) {
          grid.fixed(x, y, distance !== 2 && distance !== 4);
        }
      }
    }
  }
  const positions = alignmentPositions(version);
  const last = positions.length - 1;
  positions.forEach((px, i) => {
    positions.forEach((py, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          grid.fixed(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    });
  });
  drawFormatBits(grid, 0);
  if (version >= 7) {
    let remainder = version;
    for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const bits = (version << 12) | remainder;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      grid.fixed(a, b, bit(bits, i));
      grid.fixed(b, a, bit(bits, i));
    }
  }
}

function drawFormatBits(grid: Grid, mask: number): void {
  const data = (LEVEL_M_BITS << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const bits = ((data << 10) | remainder) ^ 0x5412;
  const size = grid.size;
  for (let i = 0; i <= 5; i++) grid.fixed(8, i, bit(bits, i));
  grid.fixed(8, 7, bit(bits, 6));
  grid.fixed(8, 8, bit(bits, 7));
  grid.fixed(7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i++) grid.fixed(14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i++) grid.fixed(size - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i++) grid.fixed(8, size - 15 + i, bit(bits, i));
  grid.fixed(8, size - 8, true);
}

function drawCodewords(grid: Grid, codewords: readonly number[]): void {
  const size = grid.size;
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (!(grid.reserved[y] as boolean[])[x] && index < codewords.length * 8) {
          (grid.modules[y] as boolean[])[x] = bit(
            codewords[index >>> 3] as number,
            7 - (index & 7),
          );
          index++;
        }
      }
    }
  }
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

function applyMask(grid: Grid, mask: number): void {
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      if (!(grid.reserved[y] as boolean[])[x] && maskApplies(mask, x, y)) {
        const row = grid.modules[y] as boolean[];
        row[x] = !row[x];
      }
    }
  }
}

const FINDER_CORE = [true, false, true, true, true, false, true];

/** Penalty rules N1 to N4 of ISO/IEC 18004 section 7.8.3. */
export function penalty(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length;
  const at = (x: number, y: number, vertical: boolean) =>
    vertical ? (modules[x] as boolean[])[y] : (modules[y] as boolean[])[x];
  let score = 0;
  for (const vertical of [false, true]) {
    for (let y = 0; y < size; y++) {
      let run = 1;
      for (let x = 1; x <= size; x++) {
        if (x < size && at(x, y, vertical) === at(x - 1, y, vertical)) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      // Dark-light-dark-dark-dark-light-dark with four light modules on either side; modules
      // outside the symbol count as light (the quiet zone).
      const light = (from: number) => {
        for (let k = from; k < from + 4; k++) {
          if (k >= 0 && k < size && at(k, y, vertical)) return false;
        }
        return true;
      };
      for (let x = 0; x + 7 <= size; x++) {
        if (FINDER_CORE.every((dark, k) => at(x + k, y, vertical) === dark)) {
          if (light(x - 4) || light(x + 7)) score += 40;
        }
      }
    }
  }
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = (modules[y] as boolean[])[x];
      if (value) dark++;
      if (
        x + 1 < size &&
        y + 1 < size &&
        value === (modules[y] as boolean[])[x + 1] &&
        value === (modules[y + 1] as boolean[])[x] &&
        value === (modules[y + 1] as boolean[])[x + 1]
      ) {
        score += 3;
      }
    }
  }
  const total = size * size;
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return score;
}

/** Encodes `text` as UTF-8 bytes. Throws when the data does not fit version 40 at level M. */
export function encodeQr(text: string, options: QrOptions = {}): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_BYTES) throw new Error('QR data too long');
  if (
    options.mask !== undefined &&
    !(Number.isInteger(options.mask) && options.mask >= 0 && options.mask <= 7)
  ) {
    throw new Error('Invalid QR mask');
  }
  let version = Math.max(1, Math.min(40, Math.floor(options.minVersion ?? 1)));
  for (; ; version++) {
    if (version > 40) throw new Error('QR data too long');
    const needed = 4 + (version <= 9 ? 8 : 16) + bytes.length * 8;
    if (needed <= dataCodewords(version) * 8) break;
  }
  const codewords = interleave(encodeData(bytes, version), version);
  const size = version * 4 + 17;
  const build = (mask: number): Grid => {
    const grid = new Grid(size);
    drawFunctionPatterns(grid, version);
    drawCodewords(grid, codewords);
    applyMask(grid, mask);
    drawFormatBits(grid, mask);
    return grid;
  };
  let best = options.mask ?? 0;
  if (options.mask === undefined) {
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const score = penalty(build(mask).modules);
      if (score < bestScore) {
        bestScore = score;
        best = mask;
      }
    }
  }
  return { version, mask: best, size, modules: build(best).modules };
}

/**
 * One SVG path for the dark modules with a four-module quiet zone, built from integers only,
 * so the template binds it as an attribute and never parses markup.
 */
export function qrPath(matrix: QrMatrix, quiet = 4): { d: string; viewBox: string } {
  const parts: string[] = [];
  matrix.modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
    });
  });
  const extent = matrix.size + quiet * 2;
  return { d: parts.join(''), viewBox: `0 0 ${extent} ${extent}` };
}
