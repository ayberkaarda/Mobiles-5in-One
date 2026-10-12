import { filterLines, SAMPLE_CITY_LINES } from './sample-lines';

describe('SAMPLE_CITY_LINES', () => {
  it('is labelled as sample data only', () => {
    for (const line of SAMPLE_CITY_LINES) {
      expect(line.name.startsWith('[ÖRNEK]')).toBe(true);
      expect(line.code.startsWith('ORN-')).toBe(true);
    }
  });
});

describe('filterLines', () => {
  it('returns everything for an empty query and the all filter', () => {
    expect(filterLines(SAMPLE_CITY_LINES, '  ', 'all')).toHaveLength(3);
  });

  it('matches code and name with Turkish case folding', () => {
    expect(filterLines(SAMPLE_CITY_LINES, 'orn-2', 'all').map((l) => l.code)).toEqual(['ORN-2']);
    expect(filterLines(SAMPLE_CITY_LINES, 'HAT ORN-3', 'all').map((l) => l.code)).toEqual([
      'ORN-3',
    ]);
    expect(filterLines(SAMPLE_CITY_LINES, '[örnek]', 'all')).toHaveLength(3);
  });

  it('combines the query with the mode filter', () => {
    expect(filterLines(SAMPLE_CITY_LINES, '', 'servis').map((l) => l.code)).toEqual(['ORN-3']);
    expect(filterLines(SAMPLE_CITY_LINES, 'orn-1', 'minibus')).toEqual([]);
  });
});
