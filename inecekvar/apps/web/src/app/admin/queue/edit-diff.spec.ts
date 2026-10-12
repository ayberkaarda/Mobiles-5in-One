import { describeChanges, hasPhoto, projectMapDiff } from './edit-diff';

const line = (coordinates: number[][]) => ({ type: 'LineString' as const, coordinates });

describe('edit diff', () => {
  it('formats fare, hours and notes changes as plain text rows', () => {
    const rows = describeChanges({
      diff: {
        fare_minor: { from: 2500, to: 3000 },
        hours_text: { from: null, to: '06:00-23:00' },
        hail_notes: { from: 'eski', to: '<script>alert(1)</script>' },
        payment_methods: { from: ['nakit'], to: ['nakit', 'kart'] },
        stop_ids: { from: ['a', 'b'], to: ['a', 'b', 'c'] },
        status: { from: 'published', to: 'retired' },
      },
    });
    const byField = Object.fromEntries(rows.map((row) => [row.field, row]));
    expect(byField['fare_minor']).toMatchObject({ label: 'Ücret' });
    expect(byField['fare_minor']?.from).toMatch(/25,00/);
    expect(byField['fare_minor']?.to).toMatch(/30,00/);
    expect(byField['hours_text']).toMatchObject({ from: '—', to: '06:00-23:00' });
    // User text stays the same string; the template interpolates it as text.
    expect(byField['hail_notes']?.to).toBe('<script>alert(1)</script>');
    expect(byField['payment_methods']?.to).toBe('nakit, kart');
    expect(byField['stop_ids']).toMatchObject({ from: '2 durak', to: '3 durak' });
    expect(byField['status']).toMatchObject({ from: 'Yayında', to: 'Kaldırıldı' });
  });

  it('shows a free fare and bounds long text', () => {
    const rows = describeChanges({
      diff: { fare_minor: { from: 2500, to: 0 }, hours_text: { from: null, to: 'x'.repeat(2000) } },
    });
    expect(rows[0]?.to).toBe('Ücretsiz');
    expect(Array.from(rows[1]?.to ?? '').length).toBe(601);
  });

  it('ignores malformed diffs', () => {
    expect(describeChanges({ diff: null })).toEqual([]);
    expect(describeChanges({ diff: [1, 2] })).toEqual([]);
    expect(describeChanges({ diff: { name: 'not an object' } })).toEqual([]);
  });

  it('projects old and new geometry into one frame from numbers only', () => {
    const drawing = projectMapDiff({
      current_geometry: line([
        [34.01, 42.51],
        [34.03, 42.51],
        [34.05, 42.51],
      ]),
      proposed_geometry: line([
        [34.01, 42.51],
        [34.03, 42.53],
        [34.05, 42.51],
      ]),
    });
    expect(drawing).not.toBeNull();
    expect(drawing?.changed).toBe(true);
    expect(drawing?.viewBox).toBe('0 0 480 240');
    for (const path of [drawing?.before, drawing?.after]) {
      expect(path).toMatch(/^M [\d.]+ [\d.]+( L [\d.]+ [\d.]+)+$/);
    }
  });

  it('marks an unchanged route and skips invalid points', () => {
    const same = line([
      [34.01, 42.51],
      [34.05, 42.55],
    ]);
    expect(projectMapDiff({ current_geometry: same, proposed_geometry: same })?.changed).toBe(
      false,
    );
    expect(
      projectMapDiff({
        current_geometry: line([
          [Number.NaN, 1],
          [500, 1],
        ]),
        proposed_geometry: null,
      }),
    ).toBeNull();
  });

  it('detects a photo id in the payload', () => {
    expect(hasPhoto({ payload: { photo_id: '0192' } })).toBe(true);
    expect(hasPhoto({ payload: { photo_id: null } })).toBe(false);
  });
});
