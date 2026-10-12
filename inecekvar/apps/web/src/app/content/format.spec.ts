import {
  clipWords,
  countWords,
  formatFare,
  formatTurkishDate,
  isoDateOnly,
  normalizeText,
} from './format';

describe('content formatting', () => {
  it('uses the Istanbul calendar day for both date forms', () => {
    expect(formatTurkishDate('2026-10-12T09:30:00Z')).toBe('12 Ekim 2026');
    expect(formatTurkishDate('2026-10-11T22:30:00Z')).toBe('12 Ekim 2026');
    expect(isoDateOnly('2026-10-11T22:30:00Z')).toBe('2026-10-12');
    expect(isoDateOnly('2026-12-31T22:00:00Z')).toBe('2027-01-01');
    expect(isoDateOnly('2026-10-12T04:30:00-05:00')).toBe('2026-10-12');
  });

  it.each(['invalid', '', '2026-10-12', '2026-10-12T12:00:00'])(
    'returns empty date text for invalid input %s',
    (iso) => {
      expect(formatTurkishDate(iso)).toBe('');
      expect(isoDateOnly(iso)).toBe('');
    },
  );

  it('formats fare minor units with the shared formatter', () => {
    expect(formatFare(2750)).toBe('₺27,50');
    expect(formatFare(0)).toBe('₺0,00');
  });

  it.each([null, NaN, Infinity, -Infinity, -1, 2.5, 10000001])(
    'returns null for invalid fare %s',
    (minor) => {
      expect(formatFare(minor)).toBeNull();
    },
  );

  it('counts and clips whitespace-separated words', () => {
    expect(countWords(' \t\n ')).toBe(0);
    expect(countWords(' bir\tiki\nüç ')).toBe(3);
    expect(clipWords(' bir\tiki\nüç ', 2)).toBe('bir iki…');
    expect(clipWords('bir iki', 2)).toBe('bir iki');
    expect(clipWords('', 2)).toBe('');
    expect(clipWords('bir', 0)).toBe('…');
    expect(() => clipWords('bir', -1)).toThrow();
    expect(() => clipWords('bir', NaN)).toThrow();
  });

  it('normalizes without a character limit and preserves plain text punctuation', () => {
    const long = 'İı şğ çö ü <b> "durak" '.repeat(60).trim();
    expect(normalizeText(long)).toBe(long);
    expect(normalizeText(' İ\u0000ı\u2028ş\tğ\nç\u007fö  ü ')).toBe('İı ş ğ çö ü');
  });
});
