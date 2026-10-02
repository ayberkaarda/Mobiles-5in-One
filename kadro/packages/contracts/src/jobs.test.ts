import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { accepts, uuidv4, uuidv7 } from './fixtures.test-helper.js';
import {
  deadLetterQueue,
  EMAIL_JOB_KINDS,
  foldTr,
  JOB_PAYLOAD_SCHEMAS,
  JOB_QUEUES,
  LIMITS,
  NOTIFICATION_TYPES,
  suggestLineup,
} from './index.js';

type JsonSchemaNode = Record<string, unknown>;

/** Every string in the JSON Schema is bounded by a length, an enum, a constant or a uuid / date-time format. */
function unboundedStrings(node: unknown, path: string): string[] {
  if (typeof node !== 'object' || node === null) {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => unboundedStrings(item, `${path}[${index}]`));
  }
  const schema = node as JsonSchemaNode;
  const own =
    schema.type === 'string' &&
    schema.maxLength === undefined &&
    schema.enum === undefined &&
    schema.const === undefined &&
    schema.format !== 'uuid' &&
    schema.format !== 'date-time'
      ? [path]
      : [];
  return [
    ...own,
    ...Object.entries(schema).flatMap(([key, value]) => unboundedStrings(value, `${path}.${key}`)),
  ];
}

function sampleJob(queue: (typeof JOB_QUEUES)[number]): Record<string, unknown> {
  const idempotencyKey = `${queue}:${uuidv7()}`;
  switch (queue) {
    case 'email.send':
      return { kind: 'verify_email', userId: uuidv7(), requestId: 'req_1', idempotencyKey };
    case 'push.send':
      return { type: 'rsvp.promoted', userId: uuidv7(), refId: uuidv7(), idempotencyKey };
    case 'push.receipts':
      return { tickets: [{ ticketId: uuidv4(), pushTokenId: uuidv7() }], idempotencyKey };
    case 'match.reminder':
      return {
        matchId: uuidv7(),
        reminder: '24h',
        startsAt: new Date().toISOString(),
        idempotencyKey,
      };
    case 'upload.process':
      return { uploadId: uuidv7(), idempotencyKey };
    case 'account.hard_delete':
      return { deletionRequestId: uuidv7(), idempotencyKey };
    case 'opencall.expire':
    case 'maintenance.sweep':
      return { idempotencyKey };
    case 'venue.import':
      return { importId: uuidv7(), idempotencyKey };
  }
}

describe('job contracts', () => {
  it('defines a payload schema for every queue and a dead-letter name', () => {
    expect(Object.keys(JOB_PAYLOAD_SCHEMAS).sort()).toEqual([...JOB_QUEUES].sort());
    expect(deadLetterQueue('email.send')).toBe('email.send.dead');
  });

  it('accepts a well-formed payload per queue and rejects any extra key', () => {
    for (const queue of JOB_QUEUES) {
      const schema = JOB_PAYLOAD_SCHEMAS[queue];
      const job = sampleJob(queue);
      expect(accepts(schema, job), queue).toBe(true);
      for (const extra of [{ email: 'a@example.com' }, { token: 'x' }, { name: 'Ayşe' }]) {
        expect(accepts(schema, { ...job, ...extra }), queue).toBe(false);
      }
      const { idempotencyKey: _key, ...withoutKey } = job;
      expect(accepts(schema, withoutKey), queue).toBe(false);
    }
  });

  it('contains no unbounded string field', () => {
    for (const queue of JOB_QUEUES) {
      const jsonSchema = z.toJSONSchema(JOB_PAYLOAD_SCHEMAS[queue], { io: 'input' });
      expect(unboundedStrings(jsonSchema, queue)).toEqual([]);
    }
  });

  it('bounds idempotency keys and their alphabet', () => {
    const schema = JOB_PAYLOAD_SCHEMAS['upload.process'];
    const at = (idempotencyKey: string) => accepts(schema, { uploadId: uuidv7(), idempotencyKey });
    expect(at('u'.repeat(LIMITS.idempotencyKey.max))).toBe(true);
    expect(at('u'.repeat(LIMITS.idempotencyKey.max + 1))).toBe(false);
    expect(at('')).toBe(false);
    expect(at('upload key')).toBe(false);
  });

  it('allows a null user only for password reset emails', () => {
    const schema = JOB_PAYLOAD_SCHEMAS['email.send'];
    const job = { userId: null, requestId: 'req_1', idempotencyKey: 'email:reset:1' };
    expect(accepts(schema, { ...job, kind: 'password_reset' })).toBe(true);
    expect(accepts(schema, { ...job, kind: 'verify_email' })).toBe(false);
    expect(EMAIL_JOB_KINDS).not.toContain('deletion_completed');
    expect(accepts(schema, { ...job, kind: 'deletion_completed', userId: uuidv7() })).toBe(false);
  });

  it('uses the closed notification type set', () => {
    expect(NOTIFICATION_TYPES).toHaveLength(9);
    const schema = JOB_PAYLOAD_SCHEMAS['push.send'];
    expect(
      accepts(schema, {
        type: 'opencall.nearby',
        userId: uuidv7(),
        refId: uuidv7(),
        idempotencyKey: 'push:1',
      }),
    ).toBe(false);
  });

  it('bounds receipt batches to one Expo request', () => {
    const schema = JOB_PAYLOAD_SCHEMAS['push.receipts'];
    const ticket = () => ({ ticketId: uuidv4(), pushTokenId: uuidv7() });
    const at = (count: number) =>
      accepts(schema, { tickets: Array.from({ length: count }, ticket), idempotencyKey: 'r:1' });
    expect(at(1)).toBe(true);
    expect(at(100)).toBe(true);
    expect(at(0)).toBe(false);
    expect(at(101)).toBe(false);
  });
});

describe('foldTr', () => {
  it('folds Turkish case and diacritics to one search key', () => {
    expect(foldTr('Kadıköy')).toBe('kadikoy');
    expect(foldTr('KADIKÖY')).toBe('kadikoy');
    expect(foldTr('kadikoy')).toBe('kadikoy');
    expect(foldTr('  İSTANBUL   Şişli ')).toBe('istanbul sisli');
    expect(foldTr('Çağlayan Gökçe Ümraniye')).toBe('caglayan gokce umraniye');
    expect(foldTr('IĞDIR')).toBe('igdir');
  });
});

describe('suggestLineup', () => {
  const player = (position: 'GK' | 'DEF' | 'MID' | 'FWD' | null) => ({
    userId: uuidv7(),
    position,
  });

  it('splits goalkeepers first and balances positions across sides', () => {
    const players = [
      player('FWD'),
      player('GK'),
      player('DEF'),
      player('GK'),
      player('DEF'),
      player('MID'),
      player('MID'),
      player('FWD'),
      player(null),
      player(null),
    ];
    const lineup = suggestLineup(players, 10);
    expect(lineup).toHaveLength(10);
    const sideOf = new Map(lineup.map((entry) => [entry.userId, entry.side]));
    for (const position of ['GK', 'DEF', 'MID', 'FWD', null] as const) {
      const sides = players
        .filter((candidate) => candidate.position === position)
        .map((candidate) => sideOf.get(candidate.userId));
      expect(sides.filter((side) => side === 'A')).toHaveLength(1);
      expect(sides.filter((side) => side === 'B')).toHaveLength(1);
    }
    expect(lineup[0]?.userId).toBe(players[1]?.userId);
  });

  it('is deterministic and respects the side capacity', () => {
    const players = Array.from({ length: 7 }, () => player('MID'));
    const first = suggestLineup(players, 6);
    expect(suggestLineup(players, 6)).toEqual(first);
    expect(first.filter((entry) => entry.side === 'A')).toHaveLength(3);
    expect(first.filter((entry) => entry.side === 'B')).toHaveLength(3);
    const odd = suggestLineup(
      Array.from({ length: 5 }, () => player('DEF')),
      5,
    );
    expect(odd.filter((entry) => entry.side === 'A')).toHaveLength(3);
    expect(odd.filter((entry) => entry.side === 'B')).toHaveLength(2);
    expect(suggestLineup([], 10)).toEqual([]);
  });
});
