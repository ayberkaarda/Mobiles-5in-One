import { ACTIONS, type Action, type ErrorCode } from '@kadro/contracts';
import { describe, expect, it } from 'vitest';

import {
  type ActorContext,
  can,
  type Decision,
  type DenyStatus,
  POLICY_RULES,
  PolicyContextError,
  type ResourceContext,
} from './policies.js';

// ---------------------------------------------------------------------------
// Fixtures (authorization matrix §9.2)
// ---------------------------------------------------------------------------

const NOW = new Date('2026-10-01T12:00:00.000Z');
const STEP_UP_VALID = new Date(NOW.getTime() + 10 * 60_000);

const ANON: ActorContext = {
  userId: null,
  platformRole: null,
  emailVerified: false,
  deactivated: false,
  stepUpUntil: null,
  isPro: false,
};

function actor(overrides: Partial<ActorContext> = {}): ActorContext {
  return {
    userId: '0199a000-0000-7000-8000-000000000001',
    platformRole: 'user',
    emailVerified: true,
    deactivated: false,
    stepUpUntil: null,
    isPro: false,
    ...overrides,
  };
}

const USER = actor();
const MOD = actor({ platformRole: 'moderator' });
const MOD_STEP = actor({ platformRole: 'moderator', stepUpUntil: STEP_UP_VALID });
const ADMIN = actor({ platformRole: 'admin' });
const ADMIN_STEP = actor({ platformRole: 'admin', stepUpUntil: STEP_UP_VALID });

/**
 * Facts every row starts from: verified/sample venue, free team, re-auth and TOTP proofs present,
 * nested target is another member whose role is `player`. Variants override single facts.
 */
const BASE_FACTS: ResourceContext = {
  teamRole: null,
  isMatchGuest: false,
  isApplicant: false,
  isCreator: false,
  isSelf: false,
  targetTeamRole: 'player',
  newTeamRole: 'co_captain',
  targetOwnedTeams: 0,
  targetIsPro: false,
  actorOwnedTeams: 0,
  teamProLocked: false,
  venuePublic: true,
  playedAtVenue: true,
  ownsResource: true,
  reauthenticated: true,
  freshTotp: true,
};

// ---------------------------------------------------------------------------
// Matrix encoding
// ---------------------------------------------------------------------------

type Status = 401 | 403 | 404;
/** `Y` allowed; `YV` allowed only with a verified email; a status uses the default code. */
type Outcome = 'Y' | 'YV' | Status | Denial;

interface Variant {
  when: string;
  resource?: ResourceContext;
  expect: Outcome;
}

/** `rel`: evaluate with the actor's team relationship; staff get no override (ADR-0007). */
type CellSpec = Outcome | 'rel' | { base: Outcome; variants: readonly Variant[] };

const SECTIONS = {
  auth: ['anon', 'user', 'mod', 'admin'],
  me: ['anon', 'user', 'mod', 'admin'],
  teams: ['anon', 'user', 'ply', 'co', 'cap', 'gst', 'rel'],
  matches: ['anon', 'user', 'ply', 'co', 'cap', 'gst', 'rel'],
  openCalls: ['anon', 'user', 'ply', 'co', 'cap', 'gst', 'rel'],
  venues: ['anon', 'user', 'mod', 'admin'],
  uploads: ['anon', 'user', 'ply', 'co', 'cap', 'rel'],
  webhooks: ['anon'],
  admin: ['anon', 'user', 'modNoStep', 'modStep', 'adminNoStep', 'adminStep'],
} as const;

type Section = keyof typeof SECTIONS;
type Column = (typeof SECTIONS)[Section][number];

interface MatrixRow {
  action: Action;
  section: Section;
  cells: Partial<Record<Column, CellSpec>>;
}

interface Denial {
  status: DenyStatus;
  code: ErrorCode;
}

const STEP_UP: Denial = { status: 401, code: 'step_up_required' };
const UNVERIFIED: Denial = { status: 403, code: 'email_unverified' };
const ENTITLEMENT: Denial = { status: 403, code: 'entitlement_required' };
const REAUTH: Denial = { status: 401, code: 'reauth_required' };
const PARTICIPANT: Denial = { status: 409, code: 'already_participant' };

const ALL_Y = { anon: 'Y', user: 'Y', mod: 'Y', admin: 'Y' } as const;
const SELF_ONLY = { anon: 401, user: 'Y', mod: 'Y', admin: 'Y' } as const;
const ADMIN_STAFF = {
  anon: 401,
  user: {
    base: 403,
    variants: [{ when: 'user is a team captain', resource: { teamRole: 'captain' }, expect: 403 }],
  },
  modNoStep: STEP_UP,
  modStep: 'Y',
  adminNoStep: STEP_UP,
  adminStep: 'Y',
} as const satisfies Partial<Record<Column, CellSpec>>;
const ADMIN_ONLY = { ...ADMIN_STAFF, modStep: 403 } as const;
const ADMIN_PER_ACTION_TOTP: CellSpec = {
  base: 'Y',
  variants: [
    { when: 'no fresh TOTP code in the request', resource: { freshTotp: false }, expect: STEP_UP },
    { when: 'target is the actor', resource: { isSelf: true }, expect: 403 },
  ],
};
const VENUE_READ: CellSpec = {
  base: 'Y',
  variants: [
    { when: 'unverified venue', resource: { venuePublic: false }, expect: 404 },
    {
      when: 'unverified venue, actor is creator',
      resource: { venuePublic: false, isCreator: true },
      expect: 'Y',
    },
  ],
};
const REVIEW_CREATE: CellSpec = {
  base: 'YV',
  variants: [
    {
      when: 'no played match at the venue',
      resource: { playedAtVenue: false },
      expect: { status: 403, code: 'review_not_eligible' },
    },
    { when: 'unverified venue', resource: { venuePublic: false }, expect: 404 },
    {
      when: 'unverified venue, actor is creator',
      resource: { venuePublic: false, isCreator: true },
      expect: 'Y',
    },
  ],
};
const REVIEW_DELETE_OWN: CellSpec = {
  base: 'Y',
  variants: [
    { when: 'no own review at the venue', resource: { ownsResource: false }, expect: 404 },
    { when: 'unverified venue', resource: { venuePublic: false }, expect: 404 },
    {
      when: 'unverified venue, actor is creator',
      resource: { venuePublic: false, isCreator: true },
      expect: 'Y',
    },
  ],
};
/** Footnote 31: only the uploader; every other actor gets the same 404 as a missing upload. */
const UPLOADER: CellSpec = {
  base: 'Y',
  variants: [{ when: 'upload of another user', resource: { ownsResource: false }, expect: 404 }],
};
const ME_DELETE_USER: CellSpec = {
  base: 'Y',
  variants: [
    { when: 'no re-auth proof', resource: { reauthenticated: false }, expect: REAUTH },
    { when: 'no TOTP (not required for users)', resource: { freshTotp: false }, expect: 'Y' },
  ],
};
const ME_DELETE_STAFF: CellSpec = {
  base: 'Y',
  variants: [
    { when: 'no re-auth proof', resource: { reauthenticated: false }, expect: REAUTH },
    { when: 'no fresh TOTP code', resource: { freshTotp: false }, expect: STEP_UP },
  ],
};

/** Authorization matrix §3, one entry per policy action, one cell per column of its section. */
const MATRIX: readonly MatrixRow[] = [
  // §3.1 Auth
  { action: 'auth.register', section: 'auth', cells: ALL_Y },
  { action: 'auth.login', section: 'auth', cells: ALL_Y },
  { action: 'auth.refresh', section: 'auth', cells: ALL_Y },
  { action: 'auth.logout', section: 'auth', cells: SELF_ONLY },
  { action: 'auth.verifyEmail', section: 'auth', cells: ALL_Y },
  { action: 'auth.forgot', section: 'auth', cells: ALL_Y },
  { action: 'auth.reset', section: 'auth', cells: ALL_Y },
  { action: 'auth.apple', section: 'auth', cells: ALL_Y },
  { action: 'auth.google', section: 'auth', cells: ALL_Y },

  // §3.2 Self
  { action: 'me.read', section: 'me', cells: SELF_ONLY },
  { action: 'me.update', section: 'me', cells: SELF_ONLY },
  {
    action: 'me.delete',
    section: 'me',
    cells: { anon: 401, user: ME_DELETE_USER, mod: ME_DELETE_STAFF, admin: ME_DELETE_STAFF },
  },
  { action: 'pushToken.register', section: 'me', cells: SELF_ONLY },

  // §3.3 Teams, invites, members
  {
    action: 'team.list',
    section: 'teams',
    cells: { anon: 401, user: 'Y', ply: 'Y', co: 'Y', cap: 'Y', gst: 'Y', rel: 'rel' },
  },
  {
    action: 'team.create',
    section: 'teams',
    cells: { anon: 401, user: 'YV', ply: 'YV', co: 'YV', cap: 'YV', gst: 'YV', rel: 'rel' },
  },
  {
    action: 'team.read',
    section: 'teams',
    cells: { anon: 401, user: 404, ply: 'Y', co: 'Y', cap: 'Y', gst: 404, rel: 'rel' },
  },
  {
    action: 'team.update',
    section: 'teams',
    cells: { anon: 401, user: 404, ply: 403, co: 'Y', cap: 'Y', gst: 404, rel: 'rel' },
  },
  {
    action: 'team.delete',
    section: 'teams',
    cells: { anon: 401, user: 404, ply: 403, co: 403, cap: 'Y', gst: 404, rel: 'rel' },
  },
  {
    action: 'invite.create',
    section: 'teams',
    cells: { anon: 401, user: 404, ply: 403, co: 'YV', cap: 'YV', gst: 404, rel: 'rel' },
  },
  {
    action: 'invite.list',
    section: 'teams',
    cells: { anon: 401, user: 404, ply: 403, co: 'Y', cap: 'Y', gst: 404, rel: 'rel' },
  },
  {
    action: 'invite.revoke',
    section: 'teams',
    cells: { anon: 401, user: 404, ply: 403, co: 'Y', cap: 'Y', gst: 404, rel: 'rel' },
  },
  {
    action: 'invite.preview',
    section: 'teams',
    cells: { anon: 'Y', user: 'Y', ply: 'Y', co: 'Y', cap: 'Y', gst: 'Y', rel: 'rel' },
  },
  {
    action: 'invite.accept',
    section: 'teams',
    cells: {
      anon: 401,
      user: 'YV',
      ply: PARTICIPANT,
      co: PARTICIPANT,
      cap: PARTICIPANT,
      gst: 'YV',
      rel: 'rel',
    },
  },
  {
    action: 'member.updateRole',
    section: 'teams',
    cells: {
      anon: 401,
      user: 404,
      ply: {
        base: 403,
        variants: [
          { when: 'promote to captain', resource: { newTeamRole: 'captain' }, expect: 403 },
        ],
      },
      co: {
        base: 403,
        variants: [
          { when: 'target role player', resource: { newTeamRole: 'player' }, expect: 403 },
          { when: 'target role captain', resource: { newTeamRole: 'captain' }, expect: 403 },
          { when: 'own role', resource: { isSelf: true }, expect: 403 },
        ],
      },
      cap: {
        base: 'Y',
        variants: [
          { when: 'set player', resource: { newTeamRole: 'player' }, expect: 'Y' },
          { when: 'own role', resource: { isSelf: true }, expect: 403 },
          { when: 'transfer to non-owner', resource: { newTeamRole: 'captain' }, expect: 'Y' },
          {
            when: 'transfer to free owner',
            resource: { newTeamRole: 'captain', targetOwnedTeams: 1 },
            expect: ENTITLEMENT,
          },
          {
            when: 'transfer to Pro owner',
            resource: { newTeamRole: 'captain', targetOwnedTeams: 1, targetIsPro: true },
            expect: 'Y',
          },
        ],
      },
      gst: 404,
      rel: 'rel',
    },
  },
  {
    action: 'member.remove',
    section: 'teams',
    cells: {
      anon: 401,
      user: 404,
      ply: {
        base: 403,
        variants: [{ when: 'leave (self)', resource: { isSelf: true }, expect: 'Y' }],
      },
      co: {
        base: 'Y',
        variants: [
          { when: 'target co-captain', resource: { targetTeamRole: 'co_captain' }, expect: 403 },
          { when: 'target captain', resource: { targetTeamRole: 'captain' }, expect: 403 },
          {
            when: 'leave (self)',
            resource: { isSelf: true, targetTeamRole: 'co_captain' },
            expect: 'Y',
          },
        ],
      },
      cap: {
        base: 'Y',
        variants: [
          { when: 'target co-captain', resource: { targetTeamRole: 'co_captain' }, expect: 'Y' },
          {
            when: 'leave (self)',
            resource: { isSelf: true, targetTeamRole: 'captain' },
            expect: { status: 409, code: 'captain_must_transfer' },
          },
        ],
      },
      gst: 404,
      rel: 'rel',
    },
  },

  // §3.4 Matches, RSVP, lineup, payments, MVP
  {
    action: 'match.list',
    section: 'matches',
    cells: { anon: 401, user: 404, ply: 'Y', co: 'Y', cap: 'Y', gst: 404, rel: 'rel' },
  },
  {
    action: 'match.create',
    section: 'matches',
    cells: { anon: 401, user: 404, ply: 403, co: 'Y', cap: 'Y', gst: 404, rel: 'rel' },
  },
  {
    action: 'match.read',
    section: 'matches',
    cells: { anon: 401, user: 404, ply: 'Y', co: 'Y', cap: 'Y', gst: 'Y', rel: 'rel' },
  },
  {
    action: 'match.update',
    section: 'matches',
    cells: { anon: 401, user: 404, ply: 403, co: 'Y', cap: 'Y', gst: 403, rel: 'rel' },
  },
  {
    action: 'match.delete',
    section: 'matches',
    cells: { anon: 401, user: 404, ply: 403, co: 'Y', cap: 'Y', gst: 403, rel: 'rel' },
  },
  {
    action: 'rsvp.set',
    section: 'matches',
    cells: { anon: 401, user: 404, ply: 'Y', co: 'Y', cap: 'Y', gst: 'Y', rel: 'rel' },
  },
  {
    action: 'lineup.set',
    section: 'matches',
    cells: { anon: 401, user: 404, ply: 403, co: 'Y', cap: 'Y', gst: 403, rel: 'rel' },
  },
  {
    action: 'payment.mark',
    section: 'matches',
    cells: {
      anon: 401,
      user: 404,
      ply: {
        base: 403,
        variants: [{ when: 'own payment', resource: { isSelf: true }, expect: 403 }],
      },
      co: {
        base: 'Y',
        variants: [{ when: 'own payment', resource: { isSelf: true }, expect: 403 }],
      },
      cap: {
        base: 'Y',
        variants: [{ when: 'own payment', resource: { isSelf: true }, expect: 'Y' }],
      },
      gst: {
        base: 403,
        variants: [{ when: 'own payment', resource: { isSelf: true }, expect: 403 }],
      },
      rel: 'rel',
    },
  },
  {
    action: 'mvp.vote',
    section: 'matches',
    cells: { anon: 401, user: 404, ply: 'Y', co: 'Y', cap: 'Y', gst: 'Y', rel: 'rel' },
  },

  // §3.5 Open calls and applications
  {
    action: 'opencall.list',
    section: 'openCalls',
    cells: { anon: 'Y', user: 'Y', ply: 'Y', co: 'Y', cap: 'Y', gst: 'Y', rel: 'rel' },
  },
  {
    action: 'opencall.publish',
    section: 'openCalls',
    cells: { anon: 401, user: 404, ply: 403, co: 'Y', cap: 'Y', gst: 403, rel: 'rel' },
  },
  {
    action: 'opencall.close',
    section: 'openCalls',
    cells: { anon: 401, user: 404, ply: 403, co: 'Y', cap: 'Y', gst: 403, rel: 'rel' },
  },
  {
    action: 'application.create',
    section: 'openCalls',
    cells: {
      anon: 401,
      user: 'YV',
      ply: PARTICIPANT,
      co: PARTICIPANT,
      cap: PARTICIPANT,
      gst: PARTICIPANT,
      rel: 'rel',
    },
  },
  {
    action: 'application.decide',
    section: 'openCalls',
    cells: {
      anon: 401,
      user: {
        base: 404,
        variants: [{ when: 'applicant', resource: { isApplicant: true }, expect: 403 }],
      },
      ply: 404,
      co: 'Y',
      cap: 'Y',
      gst: {
        base: 404,
        variants: [
          { when: 'guest is the applicant', resource: { isApplicant: true }, expect: 403 },
        ],
      },
      rel: 'rel',
    },
  },
  {
    action: 'application.withdraw',
    section: 'openCalls',
    cells: {
      anon: 401,
      user: {
        base: 404,
        variants: [{ when: 'applicant', resource: { isApplicant: true }, expect: 'Y' }],
      },
      ply: 404,
      co: 403,
      cap: 403,
      gst: {
        base: 404,
        variants: [
          { when: 'guest is the applicant', resource: { isApplicant: true }, expect: 'Y' },
        ],
      },
      rel: 'rel',
    },
  },
  {
    action: 'application.list',
    section: 'openCalls',
    cells: {
      anon: 401,
      user: {
        base: 404,
        variants: [{ when: 'applicant (own row)', resource: { isApplicant: true }, expect: 'Y' }],
      },
      ply: 404,
      co: 'Y',
      cap: 'Y',
      gst: {
        base: 404,
        variants: [
          { when: 'guest is the applicant', resource: { isApplicant: true }, expect: 'Y' },
        ],
      },
      rel: 'rel',
    },
  },

  // §3.6 Venues and reviews
  { action: 'venue.list', section: 'venues', cells: ALL_Y },
  {
    action: 'venue.read',
    section: 'venues',
    cells: {
      anon: {
        base: 'Y',
        variants: [{ when: 'unverified venue', resource: { venuePublic: false }, expect: 404 }],
      },
      user: VENUE_READ,
      mod: VENUE_READ,
      admin: VENUE_READ,
    },
  },
  {
    action: 'venue.create',
    section: 'venues',
    cells: { anon: 401, user: 'YV', mod: 'YV', admin: 'YV' },
  },
  {
    action: 'review.create',
    section: 'venues',
    cells: { anon: 401, user: REVIEW_CREATE, mod: REVIEW_CREATE, admin: REVIEW_CREATE },
  },
  {
    action: 'review.deleteOwn',
    section: 'venues',
    cells: { anon: 401, user: REVIEW_DELETE_OWN, mod: REVIEW_DELETE_OWN, admin: REVIEW_DELETE_OWN },
  },

  // §3.7 Uploads, webhooks
  {
    action: 'upload.presign.avatar',
    section: 'uploads',
    cells: { anon: 401, user: 'Y', ply: 'Y', co: 'Y', cap: 'Y', rel: 'rel' },
  },
  {
    action: 'upload.presign.badge',
    section: 'uploads',
    cells: { anon: 401, user: 404, ply: 403, co: 'Y', cap: 'Y', rel: 'rel' },
  },
  {
    action: 'upload.complete',
    section: 'uploads',
    cells: { anon: 401, user: UPLOADER, ply: UPLOADER, co: UPLOADER, cap: UPLOADER, rel: 'rel' },
  },
  {
    action: 'upload.read',
    section: 'uploads',
    cells: { anon: 401, user: UPLOADER, ply: UPLOADER, co: UPLOADER, cap: UPLOADER, rel: 'rel' },
  },
  { action: 'webhook.revenuecat', section: 'webhooks', cells: { anon: 'Y' } },

  // §3.8 Admin
  {
    action: 'admin.stepUp',
    section: 'admin',
    cells: { ...ADMIN_STAFF, modNoStep: 'Y', adminNoStep: 'Y' },
  },
  {
    action: 'admin.totpEnroll',
    section: 'admin',
    cells: {
      ...ADMIN_STAFF,
      modNoStep: {
        base: 'Y',
        variants: [
          { when: 'no re-auth proof', resource: { reauthenticated: false }, expect: REAUTH },
        ],
      },
      adminNoStep: {
        base: 'Y',
        variants: [
          { when: 'no re-auth proof', resource: { reauthenticated: false }, expect: REAUTH },
        ],
      },
    },
  },
  { action: 'admin.read', section: 'admin', cells: ADMIN_STAFF },
  { action: 'venue.verify', section: 'admin', cells: ADMIN_STAFF },
  { action: 'review.delete', section: 'admin', cells: ADMIN_STAFF },
  { action: 'opencall.remove', section: 'admin', cells: ADMIN_STAFF },
  { action: 'venue.import', section: 'admin', cells: ADMIN_ONLY },
  {
    action: 'admin.role.manage',
    section: 'admin',
    cells: { ...ADMIN_ONLY, adminStep: ADMIN_PER_ACTION_TOTP },
  },
  {
    action: 'admin.user.deactivate',
    section: 'admin',
    cells: { ...ADMIN_ONLY, adminStep: ADMIN_PER_ACTION_TOTP },
  },
  { action: 'admin.audit.read', section: 'admin', cells: ADMIN_ONLY },
];

// ---------------------------------------------------------------------------
// Row generation
// ---------------------------------------------------------------------------

interface Subject {
  label: string;
  actor: ActorContext;
  resource: ResourceContext;
}

/** The actor and relationship facts a matrix column stands for. */
function subjectFor(column: Exclude<Column, 'rel'>): Subject {
  switch (column) {
    case 'anon':
      return { label: 'anon', actor: ANON, resource: BASE_FACTS };
    case 'user':
      return { label: 'user', actor: USER, resource: BASE_FACTS };
    case 'ply':
      return { label: 'plyA', actor: USER, resource: { ...BASE_FACTS, teamRole: 'player' } };
    case 'co':
      return { label: 'coA', actor: USER, resource: { ...BASE_FACTS, teamRole: 'co_captain' } };
    case 'cap':
      return { label: 'capA', actor: USER, resource: { ...BASE_FACTS, teamRole: 'captain' } };
    case 'gst':
      return { label: 'gstM1', actor: USER, resource: { ...BASE_FACTS, isMatchGuest: true } };
    case 'mod':
    case 'modNoStep':
      return { label: column, actor: MOD, resource: BASE_FACTS };
    case 'admin':
    case 'adminNoStep':
      return { label: column, actor: ADMIN, resource: BASE_FACTS };
    case 'modStep':
      return { label: 'modStep', actor: MOD_STEP, resource: BASE_FACTS };
    case 'adminStep':
      return { label: 'adminStep', actor: ADMIN_STEP, resource: BASE_FACTS };
  }
}

interface Case {
  name: string;
  action: Action;
  actor: ActorContext;
  resource: ResourceContext;
  expected: Decision | 'allow';
}

const DEFAULT_CODES: Record<Status, ErrorCode> = {
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
};

function expand(name: string, action: Action, subject: Subject, outcome: Outcome): Case[] {
  if (outcome === 'Y') {
    return [{ name, action, actor: subject.actor, resource: subject.resource, expected: 'allow' }];
  }
  if (outcome === 'YV') {
    return [
      {
        name: `${name} (verified)`,
        action,
        actor: subject.actor,
        resource: subject.resource,
        expected: 'allow',
      },
      {
        name: `${name} (unverified email)`,
        action,
        actor: { ...subject.actor, emailVerified: false },
        resource: subject.resource,
        expected: { allow: false, ...UNVERIFIED },
      },
    ];
  }
  const denial =
    typeof outcome === 'number' ? { status: outcome, code: DEFAULT_CODES[outcome] } : outcome;
  return [
    {
      name,
      action,
      actor: subject.actor,
      resource: subject.resource,
      expected: { allow: false, ...denial },
    },
  ];
}

function casesForCell(row: MatrixRow, column: Column, spec: CellSpec): Case[] {
  if (spec === 'rel') {
    // A moderator who is a team player gets player results; an admin with a valid step-up and no
    // relationship gets the results of a plain user (ADR-0007, fixture modPlyA).
    const playerSpec = row.cells.ply;
    const userSpec = row.cells.user;
    if (
      playerSpec === undefined ||
      userSpec === undefined ||
      playerSpec === 'rel' ||
      userSpec === 'rel'
    ) {
      throw new Error(`${row.action}: a rel column needs user and ply cells`);
    }
    const modPlyA: Subject = {
      label: 'modPlyA',
      actor: MOD_STEP,
      resource: { ...BASE_FACTS, teamRole: 'player' },
    };
    const adminNoTeam: Subject = {
      label: 'adminStep (no team)',
      actor: ADMIN_STEP,
      resource: BASE_FACTS,
    };
    return [
      ...casesForSpec(row.action, modPlyA, playerSpec),
      ...casesForSpec(row.action, adminNoTeam, userSpec),
    ];
  }
  return casesForSpec(row.action, subjectFor(column as Exclude<Column, 'rel'>), spec);
}

function casesForSpec(action: Action, subject: Subject, spec: Exclude<CellSpec, 'rel'>): Case[] {
  const name = `${action} × ${subject.label}`;
  if (typeof spec === 'object' && 'base' in spec) {
    return [
      ...expand(name, action, subject, spec.base),
      ...spec.variants.flatMap((variant) =>
        expand(
          `${name} [${variant.when}]`,
          action,
          { ...subject, resource: { ...subject.resource, ...variant.resource } },
          variant.expect,
        ),
      ),
    ];
  }
  return expand(name, action, subject, spec);
}

const MATRIX_CASES: Case[] = MATRIX.flatMap((row) =>
  Object.entries(row.cells).flatMap(([column, spec]) => casesForCell(row, column as Column, spec)),
);

function check(testCase: Case): void {
  const decision = can(testCase.actor, testCase.action, testCase.resource, { now: NOW });
  if (testCase.expected === 'allow') {
    expect(decision.allow).toBe(true);
  } else {
    expect(decision).toEqual(testCase.expected);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('authorization matrix coverage', () => {
  it('has exactly one matrix row per policy action', () => {
    const actions = MATRIX.map((row) => row.action);
    expect(new Set(actions).size).toBe(actions.length);
    expect([...actions].sort()).toEqual([...ACTIONS].sort());
  });

  it('has a policy rule for every action and no extra rules', () => {
    expect(Object.keys(POLICY_RULES).sort()).toEqual([...ACTIONS].sort());
  });

  it.each(MATRIX.map((row) => [row.action, row] as const))(
    '%s fills every column of its section',
    (_action, row) => {
      expect(Object.keys(row.cells).sort()).toEqual([...SECTIONS[row.section]].sort());
    },
  );

  it('encodes all 353 endpoint × column cells of §3', () => {
    const cells = MATRIX.reduce((sum, row) => sum + Object.keys(row.cells).length, 0);
    expect(cells).toBe(353);
  });
});

describe('authorization matrix cells', () => {
  it.each(MATRIX_CASES.map((testCase) => [testCase.name, testCase] as const))(
    '%s',
    (_name, testCase) => {
      check(testCase);
    },
  );
});

const PUBLIC_ACTIONS = new Set<Action>([
  'auth.register',
  'auth.login',
  'auth.refresh',
  'auth.verifyEmail',
  'auth.forgot',
  'auth.reset',
  'auth.apple',
  'auth.google',
  'opencall.list',
  'venue.list',
  'venue.read',
  'webhook.revenuecat',
  'invite.preview',
]);

describe('deactivated accounts (ADR-0012, fixture uDeactivated)', () => {
  const uDeactivated = actor({
    deactivated: true,
    platformRole: 'admin',
    stepUpUntil: STEP_UP_VALID,
  });
  const capFacts: ResourceContext = { ...BASE_FACTS, teamRole: 'captain' };

  it.each(ACTIONS.filter((action) => !PUBLIC_ACTIONS.has(action)))(
    '%s → 401 account_deactivated even with captain and admin relationships',
    (action) => {
      expect(can(uDeactivated, action, capFacts, { now: NOW })).toEqual({
        allow: false,
        status: 401,
        code: 'account_deactivated',
      });
    },
  );

  it('evaluates a deactivated creator as anonymous on public venue reads', () => {
    expect(
      can(uDeactivated, 'venue.read', { venuePublic: false, isCreator: true }, { now: NOW }),
    ).toEqual({ allow: false, status: 404, code: 'not_found' });
  });

  it('treats an authenticated id without a platform role as unauthenticated', () => {
    expect(can({ ...USER, platformRole: null }, 'me.read')).toEqual({
      allow: false,
      status: 401,
      code: 'unauthenticated',
    });
  });
});

describe('IDOR set (matrix §9.3)', () => {
  // capB is captain of team B and has no relationship to any team-A resource.
  const capB: Subject = { label: 'capB', actor: USER, resource: BASE_FACTS };
  const teamAActions: Action[] = [
    'team.read',
    'team.update',
    'team.delete',
    'invite.create',
    'invite.list',
    'invite.revoke',
    'member.updateRole',
    'member.remove',
    'match.list',
    'match.create',
    'match.read',
    'match.update',
    'match.delete',
    'rsvp.set',
    'lineup.set',
    'payment.mark',
    'mvp.vote',
    'opencall.publish',
    'opencall.close',
    'application.decide',
    'application.withdraw',
    'application.list',
    'upload.presign.badge',
  ];

  it.each(teamAActions)('capB on team A %s → 404', (action) => {
    expect(can(capB.actor, action, capB.resource)).toEqual({
      allow: false,
      status: 404,
      code: 'not_found',
    });
  });

  const staffActions: Action[] = [
    'team.update',
    'team.delete',
    'invite.create',
    'invite.list',
    'invite.revoke',
    'member.updateRole',
    'match.create',
    'match.update',
    'match.delete',
    'lineup.set',
    'payment.mark',
    'opencall.publish',
    'opencall.close',
    'upload.presign.badge',
  ];

  it.each(staffActions)('plyA on %s → 403', (action) => {
    expect(can(USER, action, { ...BASE_FACTS, teamRole: 'player' })).toEqual({
      allow: false,
      status: 403,
      code: 'forbidden',
    });
  });

  it.each(['team.read', 'match.list'] as const)('gstM1 on team A %s → 404', (action) => {
    expect(can(USER, action, { ...BASE_FACTS, isMatchGuest: true }).allow).toBe(false);
  });

  it('gstM1 on another match of team A (no RSVP there) → 404', () => {
    expect(can(USER, 'match.read', BASE_FACTS)).toEqual({
      allow: false,
      status: 404,
      code: 'not_found',
    });
  });
});

describe('former member (ADR-0005, fixture exPlyA)', () => {
  it('team → 404', () => {
    expect(can(USER, 'team.read', BASE_FACTS)).toMatchObject({ status: 404 });
  });

  it('locked match whose RSVP was deleted → 404', () => {
    expect(can(USER, 'match.read', { ...BASE_FACTS, isMatchGuest: false })).toMatchObject({
      status: 404,
    });
  });

  it('played match with a kept RSVP → guest projection', () => {
    expect(can(USER, 'match.read', { ...BASE_FACTS, isMatchGuest: true })).toEqual({
      allow: true,
      projection: 'guest',
    });
  });

  it('members get the member projection', () => {
    expect(can(USER, 'match.read', { ...BASE_FACTS, teamRole: 'player' })).toEqual({
      allow: true,
      projection: 'member',
    });
  });
});

describe('staff get no override on the regular API (ADR-0007)', () => {
  it('modPlyA on match.update → 403', () => {
    expect(can(MOD_STEP, 'match.update', { ...BASE_FACTS, teamRole: 'player' })).toMatchObject({
      status: 403,
    });
  });

  it('adminStep without a relationship on match.update → 404', () => {
    expect(can(ADMIN_STEP, 'match.update', BASE_FACTS)).toMatchObject({ status: 404 });
  });

  const STAFF: readonly [string, ActorContext][] = [
    ['moderator', MOD],
    ['moderator + step-up', MOD_STEP],
    ['admin', ADMIN],
    ['admin + step-up', ADMIN_STEP],
  ];

  const RELATIONS: readonly [string, ResourceContext][] = [
    ['no relationship', BASE_FACTS],
    ['player', { ...BASE_FACTS, teamRole: 'player' }],
    ['co_captain', { ...BASE_FACTS, teamRole: 'co_captain' }],
    ['captain', { ...BASE_FACTS, teamRole: 'captain' }],
    ['match guest', { ...BASE_FACTS, isMatchGuest: true }],
    ['applicant', { ...BASE_FACTS, isApplicant: true }],
  ];

  /** Expected status per relation (`Y` = allowed) for the staff-sensitive actions. */
  const EXPECTED: Record<string, Record<string, 'Y' | Status>> = {
    'match.update': {
      'no relationship': 404,
      player: 403,
      co_captain: 'Y',
      captain: 'Y',
      'match guest': 403,
      applicant: 404,
    },
    'payment.mark': {
      'no relationship': 404,
      player: 403,
      co_captain: 'Y',
      captain: 'Y',
      'match guest': 403,
      applicant: 404,
    },
    'lineup.set': {
      'no relationship': 404,
      player: 403,
      co_captain: 'Y',
      captain: 'Y',
      'match guest': 403,
      applicant: 404,
    },
    'application.decide': {
      'no relationship': 404,
      player: 404,
      co_captain: 'Y',
      captain: 'Y',
      'match guest': 404,
      applicant: 403,
    },
  };

  const explicitCases = Object.entries(EXPECTED).flatMap(([action, byRelation]) =>
    STAFF.flatMap(([staffLabel, staff]) =>
      RELATIONS.map(([relationLabel, resource]) => ({
        name: `${staffLabel} as ${relationLabel} on ${action}`,
        action: action as Action,
        staff,
        resource,
        expected: byRelation[relationLabel],
      })),
    ),
  );

  it.each(explicitCases.map((testCase) => [testCase.name, testCase] as const))(
    '%s',
    (_name, { action, staff, resource, expected }) => {
      const decision = can(staff, action, resource, { now: NOW });
      if (expected === 'Y') {
        expect(decision.allow).toBe(true);
      } else {
        expect(decision).toMatchObject({ allow: false, status: expected });
      }
    },
  );

  const regularActions = ACTIONS.filter((action) => {
    const kind = POLICY_RULES[action].kind;
    return kind === 'related' || kind === 'authenticated' || kind === 'venue' || kind === 'owned';
  });

  it.each(regularActions)(
    '%s: every staff role × relationship × self flag decides exactly like a plain user',
    (action) => {
      for (const [, staff] of STAFF) {
        for (const [, relation] of RELATIONS) {
          for (const isSelf of [false, true]) {
            const resource = { ...relation, isSelf };
            const asUser = can({ ...staff, platformRole: 'user' }, action, resource, { now: NOW });
            const asStaff = can(staff, action, resource, { now: NOW });
            if (action === 'me.delete') {
              // The only staff difference outside /admin: deletion also needs a fresh TOTP code.
              expect(asStaff.allow).toBe(asUser.allow);
            } else {
              expect(asStaff).toEqual(asUser);
            }
          }
        }
      }
    },
  );
});

describe('entitlement gates (matrix §7, ADR-0013)', () => {
  const lockedTeam: ResourceContext = { ...BASE_FACTS, teamRole: 'captain', teamProLocked: true };

  it.each(['team.update', 'invite.create', 'match.create', 'opencall.publish'] as const)(
    '%s on an is_pro_locked team → 403 entitlement_required',
    (action) => {
      expect(can(USER, action, lockedTeam)).toEqual({ allow: false, ...ENTITLEMENT });
    },
  );

  it.each(['team.read', 'match.read', 'rsvp.set', 'lineup.set', 'payment.mark'] as const)(
    '%s keeps working on an is_pro_locked team',
    (action) => {
      expect(can(USER, action, lockedTeam).allow).toBe(true);
    },
  );

  it('a player on a locked team gets the relationship denial first', () => {
    expect(can(USER, 'team.update', { ...lockedTeam, teamRole: 'player' })).toMatchObject({
      code: 'forbidden',
    });
  });

  it('a free owner creating a second team → 403 entitlement_required', () => {
    expect(can(USER, 'team.create', { actorOwnedTeams: 1 })).toEqual({
      allow: false,
      ...ENTITLEMENT,
    });
  });

  it('a Pro owner may create more teams', () => {
    expect(can({ ...USER, isPro: true }, 'team.create', { actorOwnedTeams: 3 }).allow).toBe(true);
  });

  it('maps every 409 to a specific contracts code, never the generic conflict', () => {
    for (const testCase of MATRIX_CASES) {
      const decision = can(testCase.actor, testCase.action, testCase.resource, { now: NOW });
      if (!decision.allow && decision.status === 409) {
        expect(['already_participant', 'captain_must_transfer']).toContain(decision.code);
      }
    }
  });

  it('never reports a missing entitlement with any status but 403', () => {
    const decisions = MATRIX_CASES.map((testCase) =>
      can(testCase.actor, testCase.action, testCase.resource, { now: NOW }),
    );
    for (const decision of decisions) {
      if (!decision.allow && decision.code === 'entitlement_required') {
        expect(decision.status).toBe(403);
      }
    }
  });
});

describe('step-up window', () => {
  it('rejects a step-up that ends exactly now', () => {
    expect(
      can(actor({ platformRole: 'admin', stepUpUntil: NOW }), 'admin.read', {}, { now: NOW }),
    ).toEqual({
      allow: false,
      ...STEP_UP,
    });
  });

  it('accepts a step-up that ends after now', () => {
    expect(can(ADMIN_STEP, 'admin.read', {}, { now: NOW }).allow).toBe(true);
  });

  it('uses the current time when no clock is supplied', () => {
    const future = actor({ platformRole: 'moderator', stepUpUntil: new Date(Date.now() + 60_000) });
    expect(can(future, 'admin.read').allow).toBe(true);
  });
});

describe('policy context contract', () => {
  it('throws when a reached fact is missing', () => {
    expect(() => can(USER, 'team.read', {})).toThrow(PolicyContextError);
    expect(() => can(USER, 'match.read', { teamRole: null })).toThrow(/isMatchGuest/);
    expect(() => can(USER, 'member.remove', { teamRole: 'player' })).toThrow(/isSelf/);
    expect(() => can(USER, 'team.update', { teamRole: 'captain' })).toThrow(/teamProLocked/);
  });

  it('authenticates before reading any fact', () => {
    expect(can(ANON, 'team.read', {})).toMatchObject({ status: 401 });
  });

  it('rejects unknown actions', () => {
    expect(() => can(USER, 'team.hijack' as Action, {})).toThrow(RangeError);
  });

  it('does not read team relationships for admin actions', () => {
    expect(can(ADMIN_STEP, 'admin.read', {}, { now: NOW }).allow).toBe(true);
  });
});

describe('Phase 2 rules (matrix P2 rows)', () => {
  const C1_FACTS: ResourceContext = { ...BASE_FACTS };

  it('application.list returns every row to the call staff and only the own row to an applicant', () => {
    expect(can(USER, 'application.list', { ...C1_FACTS, teamRole: 'co_captain' })).toEqual({
      allow: true,
      rows: 'all',
    });
    expect(can(USER, 'application.list', { ...C1_FACTS, teamRole: 'captain' })).toEqual({
      allow: true,
      rows: 'all',
    });
    expect(can(USER, 'application.list', { ...C1_FACTS, isApplicant: true })).toEqual({
      allow: true,
      rows: 'own',
    });
  });

  it.each([
    ['plyA', USER, { ...C1_FACTS, teamRole: 'player' as const }],
    ['gstM1', USER, { ...C1_FACTS, isMatchGuest: true }],
    ['capB', USER, C1_FACTS],
    ['modStep', MOD_STEP, C1_FACTS],
  ])('application.list by %s → 404', (_label, who, resource) => {
    expect(can(who, 'application.list', resource, { now: NOW })).toEqual({
      allow: false,
      status: 404,
      code: 'not_found',
    });
  });

  it('match-scoped allows keep their projection, application decisions carry none', () => {
    expect(can(USER, 'opencall.close', { ...C1_FACTS, teamRole: 'captain' })).toEqual({
      allow: true,
      projection: 'member',
    });
    expect(can(USER, 'application.decide', { ...C1_FACTS, teamRole: 'captain' })).toEqual({
      allow: true,
    });
  });

  it('an unverified captain cannot create invites but can list and revoke them', () => {
    const unverifiedCaptain = actor({ emailVerified: false });
    const capFacts = { ...BASE_FACTS, teamRole: 'captain' as const };
    expect(can(unverifiedCaptain, 'invite.create', capFacts)).toEqual({
      allow: false,
      ...UNVERIFIED,
    });
    expect(can(unverifiedCaptain, 'invite.list', capFacts).allow).toBe(true);
    expect(can(unverifiedCaptain, 'invite.revoke', capFacts).allow).toBe(true);
  });

  it('invite.preview is public, also for deactivated sessions', () => {
    expect(can(ANON, 'invite.preview')).toEqual({ allow: true });
    expect(can(actor({ deactivated: true }), 'invite.preview')).toEqual({ allow: true });
  });

  it.each(['upload.complete', 'upload.read', 'review.deleteOwn'] as const)(
    '%s needs no verified email',
    (action) => {
      expect(can(actor({ emailVerified: false }), action, BASE_FACTS).allow).toBe(true);
    },
  );

  it.each(['upload.complete', 'upload.read'] as const)(
    "capB on capA's upload (%s) → 404",
    (action) => {
      expect(can(USER, action, { ownsResource: false })).toEqual({
        allow: false,
        status: 404,
        code: 'not_found',
      });
    },
  );

  it('review.create without a played match → 403 review_not_eligible after the V check', () => {
    expect(can(USER, 'review.create', { ...BASE_FACTS, playedAtVenue: false })).toEqual({
      allow: false,
      status: 403,
      code: 'review_not_eligible',
    });
    expect(
      can(actor({ emailVerified: false }), 'review.create', {
        ...BASE_FACTS,
        playedAtVenue: false,
      }),
    ).toEqual({ allow: false, ...UNVERIFIED });
  });

  it('throws when the new facts are missing', () => {
    expect(() => can(USER, 'review.create', { venuePublic: true })).toThrow(/playedAtVenue/);
    expect(() => can(USER, 'upload.read', {})).toThrow(/ownsResource/);
    expect(() => can(USER, 'review.deleteOwn', { venuePublic: true })).toThrow(/ownsResource/);
  });
});

describe('applicant who is also a team member (ADR-0041, ADR-0013)', () => {
  /*
   * A user applies to a call and later joins the team through an invite. The application row
   * stays, whatever its status; the status is a state fact the policy does not read, so every
   * status must give the same decision.
   */
  const STATUSES = ['pending', 'rejected', 'withdrawn', 'accepted'] as const;

  interface Row {
    action: Action;
    role: 'co_captain' | 'captain' | 'player';
    expected: Decision;
  }

  const ROWS: Row[] = [
    // Staff always list every row; the applicant-only `own` scope applies only to non-staff.
    { action: 'application.list', role: 'co_captain', expected: { allow: true, rows: 'all' } },
    { action: 'application.list', role: 'captain', expected: { allow: true, rows: 'all' } },
    { action: 'application.list', role: 'player', expected: { allow: true, rows: 'own' } },
    // Nobody decides their own application, staff included.
    {
      action: 'application.decide',
      role: 'co_captain',
      expected: { allow: false, status: 403, code: 'forbidden' },
    },
    {
      action: 'application.decide',
      role: 'captain',
      expected: { allow: false, status: 403, code: 'forbidden' },
    },
    {
      action: 'application.decide',
      role: 'player',
      expected: { allow: false, status: 403, code: 'forbidden' },
    },
    // Withdrawing is the applicant's own act and stays allowed after joining the team.
    { action: 'application.withdraw', role: 'co_captain', expected: { allow: true } },
    { action: 'application.withdraw', role: 'captain', expected: { allow: true } },
    { action: 'application.withdraw', role: 'player', expected: { allow: true } },
  ];

  const cases = ROWS.flatMap((row) =>
    STATUSES.map(
      (status) => [`${row.role} with a ${status} application on ${row.action}`, row] as const,
    ),
  );

  it.each(cases)('%s', (_name, row) => {
    const resource = { ...BASE_FACTS, teamRole: row.role, isApplicant: true };
    expect(can(USER, row.action, resource)).toEqual(row.expected);
  });

  it('staff without an application still list every row', () => {
    expect(
      can(USER, 'application.list', { ...BASE_FACTS, teamRole: 'captain', isApplicant: false }),
    ).toEqual({ allow: true, rows: 'all' });
  });

  it('a staff member of another team who applied sees only the own row', () => {
    expect(can(USER, 'application.list', { ...BASE_FACTS, isApplicant: true })).toEqual({
      allow: true,
      rows: 'own',
    });
  });
});
