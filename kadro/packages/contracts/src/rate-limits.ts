/**
 * Rate-limit groups of authorization matrix §8. Every endpoint of the registry names its group;
 * the API reads the limits from here so the document, the registry and the limiter agree.
 * Keys are stored as keyed hashes (ADR-0023); the IP comes from the trusted proxy header only.
 */
export const RATE_LIMIT_GROUPS = {
  A: {
    description: 'Auth entry points (login, register, forgot, reset, verify-email, apple, google)',
    max: 5,
    windowSeconds: 900,
    key: 'ip+email',
  },
  R: { description: 'Refresh token rotation', max: 30, windowSeconds: 900, key: 'refresh-family' },
  T: { description: 'Admin step-up and TOTP enrollment', max: 5, windowSeconds: 900, key: 'user' },
  I: {
    description: 'Invite preview and acceptance (code probing); IP only for anonymous preview',
    max: 20,
    windowSeconds: 3_600,
    key: 'user+ip',
  },
  O: { description: 'Open-call applications', max: 30, windowSeconds: 86_400, key: 'user' },
  V: { description: 'Venue creation', max: 5, windowSeconds: 86_400, key: 'user' },
  W: { description: 'Venue reviews', max: 10, windowSeconds: 86_400, key: 'user' },
  C: {
    description: 'Open-call publishing (ADR-0037)',
    max: 10,
    windowSeconds: 86_400,
    key: 'user',
  },
  D: {
    description: 'Account deletion requests; verifies a password (ADR-0032)',
    max: 5,
    windowSeconds: 900,
    key: 'user',
  },
  U: {
    description: 'Upload presigning, rolling 24 h (ADR-0030)',
    max: 10,
    windowSeconds: 86_400,
    key: 'user',
  },
  P: { description: 'Push token registration', max: 10, windowSeconds: 86_400, key: 'user' },
  G: { description: 'All other authenticated mutations', max: 120, windowSeconds: 60, key: 'user' },
} as const satisfies Record<
  string,
  {
    readonly description: string;
    readonly max: number;
    readonly windowSeconds: number;
    readonly key: 'ip+email' | 'refresh-family' | 'user' | 'user+ip';
  }
>;
export type RateLimitGroup = keyof typeof RATE_LIMIT_GROUPS;
export const RATE_LIMIT_GROUP_NAMES = Object.keys(RATE_LIMIT_GROUPS) as RateLimitGroup[];
