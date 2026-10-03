import { describe, expect, it } from 'vitest';

import {
  alignmentPositions,
  encodeQr,
  formatBits,
  penaltyScore,
  qrPathData,
  type QrMatrix,
  reedSolomonDivisor,
  reedSolomonRemainder,
  versionBits,
  versionFor,
} from '../../lib/admin/qr';

/**
 * QR encoder of the TOTP enrollment page (ADR-0068). Known answers from ISO/IEC 18004 (format and
 * version information, alignment positions, level-M capacities, a published Reed-Solomon example)
 * plus structural checks of rendered symbols.
 */

function formatFromSymbol(matrix: QrMatrix): { first: number; second: number } {
  const at = (x: number, y: number) => (matrix.modules[y]?.[x] === true ? 1 : 0);
  let first = 0;
  const firstPositions: [number, number][] = [
    [8, 0],
    [8, 1],
    [8, 2],
    [8, 3],
    [8, 4],
    [8, 5],
    [8, 7],
    [8, 8],
    [7, 8],
    [5, 8],
    [4, 8],
    [3, 8],
    [2, 8],
    [1, 8],
    [0, 8],
  ];
  firstPositions.forEach(([x, y], i) => {
    first |= at(x, y) << i;
  });
  let second = 0;
  const size = matrix.size;
  for (let i = 0; i < 8; i += 1) {
    second |= at(size - 1 - i, 8) << i;
  }
  for (let i = 8; i < 15; i += 1) {
    second |= at(8, size - 15 + i) << i;
  }
  return { first, second };
}

function finderAt(matrix: QrMatrix, left: number, top: number): boolean {
  for (let dy = 0; dy < 7; dy += 1) {
    for (let dx = 0; dx < 7; dx += 1) {
      const ring = Math.min(dx, dy, 6 - dx, 6 - dy);
      const expected = ring !== 1;
      if ((matrix.modules[top + dy]?.[left + dx] === true) !== expected) {
        return false;
      }
    }
  }
  return true;
}

describe('qr building blocks', () => {
  it('computes the Reed-Solomon codewords of the published 1-M "HELLO WORLD" example', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(reedSolomonRemainder(data, reedSolomonDivisor(10))).toEqual([
      196, 35, 39, 119, 235, 215, 231, 226, 93, 23,
    ]);
  });

  it('produces the format information strings of level M', () => {
    const expected = [
      '101010000010010',
      '101000100100101',
      '101111001111100',
      '101101101001011',
      '100010111111001',
      '100000011001110',
      '100111110010111',
      '100101010100000',
    ];
    expected.forEach((bits, mask) => {
      expect(formatBits(mask).toString(2).padStart(15, '0'), `mask ${mask}`).toBe(bits);
    });
  });

  it('produces the version information strings', () => {
    expect(versionBits(7).toString(2).padStart(18, '0')).toBe('000111110010010100');
    expect(versionBits(40).toString(2).padStart(18, '0')).toBe('101000110001101001');
  });

  it('places alignment patterns at the tabulated centers', () => {
    expect(alignmentPositions(1)).toEqual([]);
    expect(alignmentPositions(2)).toEqual([6, 18]);
    expect(alignmentPositions(7)).toEqual([6, 22, 38]);
    expect(alignmentPositions(32)).toEqual([6, 34, 60, 86, 112, 138]);
    expect(alignmentPositions(40)).toEqual([6, 30, 58, 86, 114, 142, 170]);
  });

  it('chooses the smallest level-M version for a byte length', () => {
    expect(versionFor(14)).toBe(1);
    expect(versionFor(15)).toBe(2);
    expect(versionFor(26)).toBe(2);
    expect(versionFor(27)).toBe(3);
    expect(versionFor(2331)).toBe(40);
    expect(versionFor(2332)).toBeNull();
  });
});

describe('encodeQr', () => {
  const uri =
    'otpauth://totp/Kadro:ayse%40kadro.app?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Kadro&algorithm=SHA1&digits=6&period=30';

  it('draws finder, timing, dark module and both format copies', () => {
    for (const text of ['hello', uri, `otpauth://totp/${'a'.repeat(480)}`]) {
      const matrix = encodeQr(text);
      const { size } = matrix;
      expect(size).toBe(matrix.version * 4 + 17);
      expect(matrix.modules).toHaveLength(size);
      expect(finderAt(matrix, 0, 0)).toBe(true);
      expect(finderAt(matrix, size - 7, 0)).toBe(true);
      expect(finderAt(matrix, 0, size - 7)).toBe(true);
      for (let i = 8; i < size - 8; i += 1) {
        expect(matrix.modules[6]?.[i]).toBe(i % 2 === 0);
        expect(matrix.modules[i]?.[6]).toBe(i % 2 === 0);
      }
      expect(matrix.modules[size - 8]?.[8]).toBe(true);
      const { first, second } = formatFromSymbol(matrix);
      expect(first).toBe(formatBits(matrix.mask));
      expect(second).toBe(formatBits(matrix.mask));
    }
  });

  it('fits the longest enrollment URI the contract allows (512 characters)', () => {
    const matrix = encodeQr(`otpauth://totp/${'k'.repeat(497)}`);
    expect(matrix.version).toBeLessThanOrEqual(20);
  });

  it('is deterministic and picks the mask with the lowest penalty', () => {
    const first = encodeQr(uri);
    const second = encodeQr(uri);
    expect(second).toEqual(first);
    expect(first.mask).toBeGreaterThanOrEqual(0);
    expect(first.mask).toBeLessThan(8);
    expect(penaltyScore(first.modules)).toBeGreaterThan(0);
  });

  it('refuses text beyond version 40', () => {
    expect(() => encodeQr('x'.repeat(2400))).toThrow(RangeError);
  });

  it('renders one unit square per dark module, shifted by the quiet zone', () => {
    const matrix = encodeQr('hello');
    const dark = matrix.modules.flat().filter(Boolean).length;
    const path = qrPathData(matrix);
    expect(path.match(/M/g)).toHaveLength(dark);
    expect(path.startsWith('M4 4h1v1h-1z')).toBe(true);
    expect(
      path
        .split('z')
        .slice(0, -1)
        .every((part) => /^M\d{1,3} \d{1,3}h1v1h-1$/.test(part)),
    ).toBe(true);
  });
});
