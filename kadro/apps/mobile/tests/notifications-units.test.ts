import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  NOTIFICATION_TYPES as CONTRACT_TYPES,
  pushNotificationDataSchema,
} from '../../../packages/contracts/src/jobs';
import {
  dismissPrompt,
  PUSH_PROMPT_STORAGE_KEY,
  promptDismissed,
  shouldShowPrompt,
} from '../src/notifications/prompt';
import {
  MATCHES_HOME,
  NOTIFICATION_REF_KEY,
  NOTIFICATION_TYPES,
  notificationHref,
  parseNotificationData,
} from '../src/notifications/routing';
import { type PushPermission, type PushPort, refreshRegistration } from '../src/settings/push';

const MATCH_ID = '0192a0b0-0000-7000-8000-0000000000a1';
const TEAM_ID = '0192a0b0-0000-7000-8000-000000000001';
const APP_ID = '0192a0b0-0000-7000-8000-0000000000b1';

/**
 * The worker's `PUSH_REF_KEY` entries, read from its source (the worker module needs the built
 * contracts package, which the mobile tests do not build).
 */
function workerRefKeys(): Record<string, string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed file of the worker
  const source = readFileSync(
    fileURLToPath(new URL('../../worker/src/push/templates.ts', import.meta.url)),
    'utf8',
  );
  const block = /export const PUSH_REF_KEY[^=]*=\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';
  return Object.fromEntries(
    [...block.matchAll(/'([a-z_.0-9]+)':\s*'(\w+)'/g)].map((match) => [match[1], match[2]]),
  );
}

describe('notification payload', () => {
  it('knows the same types and reference keys as the contracts and the worker', () => {
    expect([...NOTIFICATION_TYPES]).toEqual([...CONTRACT_TYPES]);
    expect(NOTIFICATION_REF_KEY).toEqual(workerRefKeys());
  });

  it('reads the target of each kind', () => {
    expect(parseNotificationData({ type: 'match.reminder_2h', matchId: MATCH_ID })).toEqual({
      kind: 'match',
      type: 'match.reminder_2h',
      matchId: MATCH_ID,
    });
    expect(parseNotificationData({ type: 'team.member_joined', teamId: TEAM_ID })).toEqual({
      kind: 'team',
      type: 'team.member_joined',
      teamId: TEAM_ID,
    });
    for (const type of ['application.received', 'application.decided'] as const) {
      expect(parseNotificationData({ type, applicationId: APP_ID, matchId: MATCH_ID })).toEqual({
        kind: 'application',
        type,
        applicationId: APP_ID,
        matchId: MATCH_ID,
      });
    }
  });

  it('rejects anything the worker does not send', () => {
    for (const data of [
      null,
      'match.updated',
      {},
      { type: 'match.deleted', matchId: MATCH_ID },
      { type: 'match.updated', teamId: TEAM_ID },
      { type: 'match.updated', matchId: 'not-an-id' },
      { type: 'match.updated', matchId: '0192a0b0-0000-4000-8000-0000000000a1' },
      { type: 'team.member_joined', teamId: 42 },
      { type: 'application.decided', applicationId: APP_ID },
      { type: 'application.received', applicationId: APP_ID, matchId: 'not-an-id' },
      { type: 'application.received', matchId: MATCH_ID },
    ]) {
      expect(parseNotificationData(data), JSON.stringify(data)).toBeNull();
    }
  });

  it('accepts every payload shape of the contracts', () => {
    const payloads = [
      { type: 'match.updated', matchId: MATCH_ID },
      { type: 'team.member_joined', teamId: TEAM_ID },
      { type: 'application.received', applicationId: APP_ID, matchId: MATCH_ID },
      { type: 'application.decided', applicationId: APP_ID, matchId: MATCH_ID },
      { type: 'application.decided', applicationId: APP_ID },
      { type: 'rsvp.changed', applicationId: APP_ID },
    ];
    for (const data of payloads) {
      expect(parseNotificationData(data) !== null, JSON.stringify(data)).toBe(
        pushNotificationDataSchema.safeParse(data).success,
      );
    }
  });
});

describe('notificationHref', () => {
  const noMatch = async (): Promise<string> => {
    throw new Error('not reached');
  };

  it('opens a match under the team the API names', async () => {
    const target = { kind: 'match', type: 'match.updated', matchId: MATCH_ID } as const;
    const asked: string[] = [];
    const href = await notificationHref(target, async (id) => {
      asked.push(id);
      return TEAM_ID;
    });
    expect(asked).toEqual([MATCH_ID]);
    expect(href).toBe(`/takim/${TEAM_ID}/mac/${MATCH_ID}`);
  });

  it('opens the matches tab when the match cannot be read', async () => {
    const target = { kind: 'match', type: 'rsvp.promoted', matchId: MATCH_ID } as const;
    expect(await notificationHref(target, noMatch)).toBe(MATCHES_HOME);
  });

  it('opens the team', async () => {
    expect(
      await notificationHref(
        { kind: 'team', type: 'team.member_joined', teamId: TEAM_ID },
        noMatch,
      ),
    ).toBe(`/takim/${TEAM_ID}`);
  });

  it("opens the staff view of the call's match for a received application", async () => {
    const target = {
      kind: 'application',
      type: 'application.received',
      applicationId: APP_ID,
      matchId: MATCH_ID,
    } as const;
    expect(await notificationHref(target, noMatch)).toBe(`/ilan/mac/${MATCH_ID}`);
  });

  it('opens the match of a decided application, else the Eksik Var tab', async () => {
    const target = {
      kind: 'application',
      type: 'application.decided',
      applicationId: APP_ID,
      matchId: MATCH_ID,
    } as const;
    const asked: string[] = [];
    const href = await notificationHref(target, async (id) => {
      asked.push(id);
      return TEAM_ID;
    });
    expect(asked).toEqual([MATCH_ID]);
    expect(href).toBe(`/takim/${TEAM_ID}/mac/${MATCH_ID}`);
    const refused = async (): Promise<string> => {
      throw new Error('not found');
    };
    expect(await notificationHref(target, refused)).toBe('/eksik-var');
  });
});

function fakePort(permission: PushPermission, platform: 'ios' | 'android' | null = 'android') {
  const port: PushPort & { prompts: number } = {
    prompts: 0,
    platform,
    permission: async () => permission,
    requestPermission: async () => {
      port.prompts += 1;
      return permission;
    },
    expoToken: async () => 'ExponentPushToken[device-1]',
  };
  return port;
}

describe('refreshRegistration', () => {
  it('registers silently when notifications are already allowed', async () => {
    const bodies: unknown[] = [];
    const port = fakePort('granted');
    const outcome = await refreshRegistration(port, {
      registerPushToken: async (body) => {
        bodies.push(body);
      },
    });
    expect(outcome).toBe('registered');
    expect(bodies).toEqual([{ expoToken: 'ExponentPushToken[device-1]', platform: 'android' }]);
  });

  it('never asks and never registers without the permission', async () => {
    for (const permission of ['undetermined', 'denied'] as const) {
      const port = fakePort(permission);
      let calls = 0;
      const outcome = await refreshRegistration(port, {
        registerPushToken: async () => {
          calls += 1;
        },
      });
      expect(outcome).toBeNull();
      expect(port.prompts).toBe(0);
      expect(calls).toBe(0);
    }
    expect(
      await refreshRegistration(fakePort('granted', null), {
        registerPushToken: async () => undefined,
      }),
    ).toBe('unavailable');
  });
});

describe('notification card preference', () => {
  function memoryStorage(failing = false) {
    const items = new Map<string, string>();
    return {
      items,
      getItem: async (key: string) => {
        if (failing) {
          throw new Error('unreadable');
        }
        return items.get(key) ?? null;
      },
      setItem: async (key: string, value: string) => {
        if (failing) {
          throw new Error('unwritable');
        }
        items.set(key, value);
      },
    };
  }

  it('remembers "not now" on this device under a non-credential key', async () => {
    const storage = memoryStorage();
    expect(await promptDismissed(storage)).toBe(false);
    await dismissPrompt(storage);
    expect(await promptDismissed(storage)).toBe(true);
    expect([...storage.items.keys()]).toEqual([PUSH_PROMPT_STORAGE_KEY]);
    expect(PUSH_PROMPT_STORAGE_KEY).not.toMatch(/token|secret|password|session|credential/i);
  });

  it('shows the card again when the storage fails', async () => {
    const storage = memoryStorage(true);
    await dismissPrompt(storage);
    expect(await promptDismissed(storage)).toBe(false);
  });

  it('shows the card only while the user has not decided', () => {
    expect(shouldShowPrompt(true, 'undetermined', false)).toBe(true);
    expect(shouldShowPrompt(true, 'undetermined', true)).toBe(false);
    expect(shouldShowPrompt(true, 'granted', false)).toBe(false);
    expect(shouldShowPrompt(true, 'denied', false)).toBe(false);
    expect(shouldShowPrompt(false, 'undetermined', false)).toBe(false);
  });
});
