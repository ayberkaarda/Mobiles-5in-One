import { formatFareMinor, MAX_FARE_MINOR } from './fare';
import { isHealthStatus } from './health';
import { isLineMode, LINE_MODES } from './line-mode';

describe('line modes', () => {
  it('accepts exactly the three modes of the data model', () => {
    expect(LINE_MODES).toEqual(['dolmus', 'minibus', 'servis']);
    expect(LINE_MODES.every(isLineMode)).toBe(true);
    expect(isLineMode('otobus')).toBe(false);
    expect(isLineMode(1)).toBe(false);
  });
});

describe('formatFareMinor', () => {
  it('formats kuruş as Turkish lira', () => {
    expect(formatFareMinor(2750).replace(/\s/g, '')).toBe('₺27,50');
    expect(formatFareMinor(0).replace(/\s/g, '')).toBe('₺0,00');
  });

  it('rejects values outside the accepted range', () => {
    expect(() => formatFareMinor(-1)).toThrow(RangeError);
    expect(() => formatFareMinor(MAX_FARE_MINOR + 1)).toThrow(RangeError);
    expect(() => formatFareMinor(10.5)).toThrow(RangeError);
  });
});

describe('isHealthStatus', () => {
  it('accepts only the bare ok body', () => {
    expect(isHealthStatus({ status: 'ok' })).toBe(true);
    expect(isHealthStatus({ status: 'ok', version: '1' })).toBe(false);
    expect(isHealthStatus({ status: 'down' })).toBe(false);
    expect(isHealthStatus(null)).toBe(false);
  });
});
