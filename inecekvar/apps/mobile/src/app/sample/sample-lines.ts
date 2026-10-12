import { LineMode } from '@inecekvar/domain';

export interface LineSummary {
  slug: string;
  code: string;
  name: string;
  mode: LineMode;
  /** Fare in kuruş; `null` when unknown. */
  fareMinor: number | null;
  stopCount: number;
  hoursText: string;
}

/**
 * The labelled development sample, mirroring `api/app/seed/sample_city.py` (`[ÖRNEK] Test
 * Şehri`). It lets the shell render real component states before the city pack and search
 * clients exist; it is never shown as real line data.
 */
export const SAMPLE_CITY_LINES: readonly LineSummary[] = [
  {
    slug: 'ornek-hat-1',
    code: 'ORN-1',
    name: '[ÖRNEK] Hat ORN-1',
    mode: 'dolmus',
    fareMinor: 2500,
    stopCount: 5,
    hoursText: '[ÖRNEK] 06:00-23:00',
  },
  {
    slug: 'ornek-hat-2',
    code: 'ORN-2',
    name: '[ÖRNEK] Hat ORN-2',
    mode: 'minibus',
    fareMinor: 3000,
    stopCount: 5,
    hoursText: '[ÖRNEK] 06:00-23:00',
  },
  {
    slug: 'ornek-hat-3',
    code: 'ORN-3',
    name: '[ÖRNEK] Hat ORN-3',
    mode: 'servis',
    fareMinor: 0,
    stopCount: 4,
    hoursText: '[ÖRNEK] 06:00-23:00',
  },
];

/** Case- and dotted-İ-insensitive match on code or name, then an optional mode filter. */
export function filterLines(
  lines: readonly LineSummary[],
  query: string,
  mode: LineMode | 'all',
): LineSummary[] {
  const needle = query.trim().toLocaleLowerCase('tr');
  return lines.filter(
    (line) =>
      (mode === 'all' || line.mode === mode) &&
      (needle === '' ||
        line.code.toLocaleLowerCase('tr').includes(needle) ||
        line.name.toLocaleLowerCase('tr').includes(needle)),
  );
}
