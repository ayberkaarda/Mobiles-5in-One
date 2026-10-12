import { buildAuditQuery, EMPTY_FILTERS } from './audit.page';

const now = new Date('2026-10-12T12:00:00Z');

describe('audit filters', () => {
  it('defaults to the last 30 days', () => {
    const result = buildAuditQuery(EMPTY_FILTERS, 0, now);
    expect(result).toEqual({
      query: {
        limit: 25,
        offset: 0,
        since: '2026-09-12T12:00:00.000Z',
        until: '2026-10-12T12:00:00.000Z',
      },
    });
  });

  it('accepts a 366-day window and refuses a longer one', () => {
    expect(
      'query' in
        buildAuditQuery({ ...EMPTY_FILTERS, since: '2025-10-12', until: '2026-10-11' }, 0, now),
    ).toBe(true);
    expect(
      buildAuditQuery({ ...EMPTY_FILTERS, since: '2025-10-01', until: '2026-10-11' }, 0, now),
    ).toEqual({
      error: 'Tarih aralığı en fazla 366 gün olabilir.',
    });
  });

  it('refuses a start after the end', () => {
    expect(
      buildAuditQuery({ ...EMPTY_FILTERS, since: '2026-10-11', until: '2026-10-01' }, 0, now),
    ).toEqual({
      error: 'Başlangıç tarihi bitişten sonra olamaz.',
    });
  });

  it.each([
    { action: 'Moderation.Rollback' },
    { action: 'x'.repeat(65) },
    { targetType: 'line;drop' },
    { actorId: 'not-a-uuid' },
    { targetId: '123' },
  ])('validates names and ids like the API: %o', (patch) => {
    expect('error' in buildAuditQuery({ ...EMPTY_FILTERS, ...patch }, 0, now)).toBe(true);
  });

  it('passes valid filters and uses Istanbul day bounds', () => {
    const result = buildAuditQuery(
      {
        action: 'moderation.rollback',
        targetType: 'line',
        actorId: '0192F2B7-0000-7000-8000-000000000001',
        targetId: '',
        since: '2026-10-01',
        until: '2026-10-12',
      },
      50,
      now,
    );
    expect(result).toEqual({
      query: {
        limit: 25,
        offset: 50,
        action: 'moderation.rollback',
        target_type: 'line',
        actor_id: '0192f2b7-0000-7000-8000-000000000001',
        since: '2026-09-30T21:00:00.000Z',
        until: '2026-10-12T20:59:59.999Z',
      },
    });
  });
});
