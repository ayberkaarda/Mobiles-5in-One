import { type Action, type ErrorCode, type PlatformRole, type TeamRole } from '@kadro/contracts';

/**
 * Declarative authorization policy. This module is the code mirror of
 * docs/security/authorization-matrix.md §3 (endpoint × role cells) and the role/relationship parts
 * of §4. State preconditions (match status, invite validity, slot counts, ...) are not decided
 * here; they belong to the domain services and return 409 after `can()` allowed the request.
 *
 * Evaluation order (matrix §2, ADR-0013):
 * 1. authentication: missing credentials → 401 `unauthenticated`, deactivated → 401
 *    `account_deactivated` (ADR-0012);
 * 2. read relationship: no relationship to the addressed resource → 404 `not_found`;
 * 3. email verification on **V** actions → 403 `email_unverified`;
 * 4. role / relationship cell → allow, 403 `forbidden` or a relationship conflict (409
 *    `already_participant`, `captain_must_transfer`);
 * 5. entitlement gates → 403 `entitlement_required`.
 * Admin actions use their own order: staff role → step-up → admin tier → per-action proof.
 *
 * Platform staff are evaluated exactly like a `user` outside the `admin` rules (ADR-0007): the
 * regular rules never read `actor.platformRole`.
 */

export type { Action, PlatformRole, TeamRole };

/** Who is calling. Built per request from the database row, never from token claims (ADR-0012). */
export interface ActorContext {
  /** `null` for an unauthenticated caller (policy role `guest`). */
  userId: string | null;
  /** `users.role`; `null` for an unauthenticated caller. */
  platformRole: PlatformRole | null;
  /** `users.email_verified_at IS NOT NULL`. */
  emailVerified: boolean;
  /** `users.deactivated_at IS NOT NULL`. */
  deactivated: boolean;
  /** Expiry of the server-side step-up record bound to the session or refresh family. */
  stepUpUntil: Date | null;
  /** Active Kadro Pro entitlement from `subscriptions` (Phase 5). */
  isPro: boolean;
}

/**
 * Facts about the addressed resource, computed server-side through the read-scoped queries of
 * matrix §5. Each action reads only the facts it needs; a fact the evaluation reaches but the
 * caller did not supply raises {@link PolicyContextError} instead of silently defaulting.
 */
export interface ResourceContext {
  /** Actor's role in the team that owns the resource; `null` when the actor is not a member. */
  teamRole?: TeamRole | null;
  /** Actor holds an RSVP on the match without being a team member (`guest(M)`). */
  isMatchGuest?: boolean;
  /** Actor is the applicant of the addressed application (`applicant(A)`). */
  isApplicant?: boolean;
  /** Actor created the addressed venue (`creator(V)`). */
  isCreator?: boolean;
  /** The nested target (member, payment row, user) is the actor (`self`). */
  isSelf?: boolean;
  /** Team role of the nested member target (`member.remove`, `member.updateRole`). */
  targetTeamRole?: TeamRole;
  /** Requested role for `member.updateRole`; `captain` means captaincy transfer. */
  newTeamRole?: TeamRole;
  /** Number of teams the transfer target already owns (captaincy transfer only). */
  targetOwnedTeams?: number;
  /** Transfer target has an active Pro entitlement (captaincy transfer only). */
  targetIsPro?: boolean;
  /** Number of teams the actor already owns (`team.create`). */
  actorOwnedTeams?: number;
  /** `teams.is_pro_locked` of the owning team. */
  teamProLocked?: boolean;
  /** Venue is `verified` or `is_sample`, i.e. readable by everyone. */
  venuePublic?: boolean;
  /**
   * Actor has an `in` RSVP on at least one `played` match at the venue (`review.create`,
   * matrix footnote 24, ADR-0038).
   */
  playedAtVenue?: boolean;
  /**
   * The addressed row belongs to the actor: the upload (`uploads.user_id`, footnote 31) or the
   * actor's own review at the venue (footnote 32). `false` when no such row exists.
   */
  ownsResource?: boolean;
  /** The request carries a valid single-use re-authentication proof (matrix footnote 4). */
  reauthenticated?: boolean;
  /** The request carries a fresh, valid TOTP code (matrix footnotes 5 and 27). */
  freshTotp?: boolean;
}

/** Projection the handler must apply to an allowed match-scoped read (matrix footnote 11). */
export type Projection = 'member' | 'guest';

/**
 * Rows an allowed list may return (`application.list`, footnote 33): `all` for the call's team
 * staff, `own` for an applicant, who sees only their own application.
 */
export type RowScope = 'all' | 'own';

export type DenyStatus = 401 | 403 | 404 | 409;

export type Decision =
  | { allow: true; projection?: Projection; rows?: RowScope }
  | { allow: false; status: DenyStatus; code: ErrorCode };

/** Thrown when an action's evaluation needs a resource fact the caller did not provide. */
export class PolicyContextError extends Error {
  readonly action: Action;
  readonly fact: keyof ResourceContext;

  constructor(action: Action, fact: keyof ResourceContext) {
    super(`Policy evaluation of "${action}" requires resource fact "${fact}"`);
    this.name = 'PolicyContextError';
    this.action = action;
    this.fact = fact;
  }
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

const ALLOW: Decision = { allow: true };

function deny(status: DenyStatus, code: ErrorCode): Decision {
  return { allow: false, status, code };
}

const UNAUTHENTICATED = deny(401, 'unauthenticated');
const DEACTIVATED = deny(401, 'account_deactivated');
const STEP_UP_REQUIRED = deny(401, 'step_up_required');
const FORBIDDEN = deny(403, 'forbidden');
const EMAIL_UNVERIFIED = deny(403, 'email_unverified');
const ENTITLEMENT_REQUIRED = deny(403, 'entitlement_required');
const NOT_FOUND = deny(404, 'not_found');
const ALREADY_PARTICIPANT = deny(409, 'already_participant');
const REAUTH_REQUIRED = deny(401, 'reauth_required');
const REVIEW_NOT_ELIGIBLE = deny(403, 'review_not_eligible');
const CAPTAIN_MUST_TRANSFER = deny(409, 'captain_must_transfer');

// ---------------------------------------------------------------------------
// Rule vocabulary
// ---------------------------------------------------------------------------

/**
 * Relationship of the actor to the resource, derived from the facts:
 * - `none`: no relationship (the matrix `user` column, including cross-tenant actors);
 * - `player` / `co_captain` / `captain`: member of the owning team (`ply` / `co` / `cap`);
 * - `guest`: match guest (`gst`);
 * - `applicant`: applicant of the addressed application (takes precedence, matrix §3.5).
 */
export type Relation = 'none' | TeamRole | 'guest' | 'applicant';

interface CellContext {
  action: Action;
  actor: ActorContext;
  resource: ResourceContext;
}

/** Outcome of one matrix cell: a fixed result or a footnote predicate. */
type Cell =
  'allow' | 'forbidden' | 'not_found' | 'already_participant' | ((ctx: CellContext) => Decision);

/**
 * - `team`: relationship from `teamRole` only (team, invite, member, badge upload);
 * - `match`: `teamRole`, else `isMatchGuest` (match-scoped actions, open-call publish/apply);
 * - `application`: `isApplicant` first, then as `match`.
 */
type Scope = 'team' | 'match' | 'application';

type Entitlement = 'ownedTeamLimit' | 'teamNotProLocked';

type Rule =
  /** Open to everyone, authenticated or not (auth entry points, public reads, webhook). */
  | { kind: 'public' }
  /** Public read of a single venue: unverified venues are visible to their creator only. */
  | { kind: 'publicVenue' }
  /** Authenticated actor acting on itself or on no particular resource. */
  | {
      kind: 'authenticated';
      verified?: true;
      entitlement?: 'ownedTeamLimit';
      /** `me.delete`: re-auth for everyone, plus a fresh TOTP code for staff. */
      reauth?: 'withStaffTotp';
    }
  /**
   * Authenticated write against a venue the actor must be able to read; `eligibility` adds the
   * played-at-venue requirement of `review.create`.
   */
  | { kind: 'venue'; verified?: true; eligibility?: 'playedAtVenue' }
  /**
   * Authenticated action on a row that must belong to the actor (`ownsResource`); anything else is
   * 404. `venue` additionally resolves the venue through the readable-venue scope first.
   */
  | { kind: 'owned'; venue?: true }
  /** Team-, match- or application-scoped action evaluated per relationship cell. */
  | {
      kind: 'related';
      scope: Scope;
      cells: Readonly<Record<Relation, Cell>>;
      verified?: true;
      entitlement?: Entitlement;
      /** List action: the allowed decision carries `rows` (`own` for applicants, else `all`). */
      rows?: true;
      /**
       * Application scope only. By default the applicant relation wins over a team role, so
       * nobody decides their own application and an applicant can always withdraw it, even after
       * joining the team. `staff` lets a captain or co-captain role win instead (`application.list`:
       * staff always see every row, ADR-0041).
       */
      precedence?: 'staff';
    }
  /** `/admin/**` action. */
  | {
      kind: 'admin';
      /** `staff`: moderator or admin; `admin`: admin only. */
      tier: 'staff' | 'admin';
      /** `establish`: the route creates the step-up itself; `required`: a valid step-up must exist. */
      stepUp: 'establish' | 'required';
      reauth?: true;
      freshTotp?: true;
      noSelfTarget?: true;
    };

// ---------------------------------------------------------------------------
// Footnote predicates
// ---------------------------------------------------------------------------

function fact<K extends keyof ResourceContext>(
  ctx: Pick<CellContext, 'action' | 'resource'>,
  key: K,
): NonNullable<ResourceContext[K]> {
  // eslint-disable-next-line security/detect-object-injection -- key is a typed ResourceContext key
  const value = ctx.resource[key];
  if (value === undefined || value === null) {
    throw new PolicyContextError(ctx.action, key);
  }
  return value;
}

/** Footnote 8: captain changes roles, never their own; transfer to a free owner needs Pro. */
function captainSetsRole(ctx: CellContext): Decision {
  if (fact(ctx, 'isSelf')) {
    return FORBIDDEN;
  }
  if (fact(ctx, 'newTeamRole') === 'captain') {
    const ownsTeam = fact(ctx, 'targetOwnedTeams') > 0;
    if (ownsTeam && !fact(ctx, 'targetIsPro')) {
      return ENTITLEMENT_REQUIRED;
    }
  }
  return ALLOW;
}

/** Footnote 9: a player may only leave. */
function playerRemoves(ctx: CellContext): Decision {
  return fact(ctx, 'isSelf') ? ALLOW : FORBIDDEN;
}

/** Footnote 9: a co-captain may leave or remove members whose role is `player`. */
function coCaptainRemoves(ctx: CellContext): Decision {
  if (fact(ctx, 'isSelf')) {
    return ALLOW;
  }
  return fact(ctx, 'targetTeamRole') === 'player' ? ALLOW : FORBIDDEN;
}

/** Footnote 9: the captain removes anyone but must transfer captaincy before leaving. */
function captainRemoves(ctx: CellContext): Decision {
  return fact(ctx, 'isSelf') ? CAPTAIN_MUST_TRANSFER : ALLOW;
}

/** Footnote 16 / ADR-0006: a co-captain never marks their own share. */
function coCaptainMarksPayment(ctx: CellContext): Decision {
  return fact(ctx, 'isSelf') ? FORBIDDEN : ALLOW;
}

// ---------------------------------------------------------------------------
// Cell presets
// ---------------------------------------------------------------------------

/** Members read; everyone else has no read relationship. */
const MEMBERS_READ = {
  none: 'not_found',
  player: 'allow',
  co_captain: 'allow',
  captain: 'allow',
  guest: 'not_found',
  applicant: 'not_found',
} as const satisfies Record<Relation, Cell>;

/** Team staff write; players are forbidden; non-members have no read relationship. */
const TEAM_STAFF_WRITE = {
  none: 'not_found',
  player: 'forbidden',
  co_captain: 'allow',
  captain: 'allow',
  guest: 'not_found',
  applicant: 'not_found',
} as const satisfies Record<Relation, Cell>;

/** Match participants read; staff write; players and guests are forbidden. */
const MATCH_STAFF_WRITE = {
  none: 'not_found',
  player: 'forbidden',
  co_captain: 'allow',
  captain: 'allow',
  guest: 'forbidden',
  applicant: 'not_found',
} as const satisfies Record<Relation, Cell>;

/** Every match participant (member or guest) may act. */
const MATCH_PARTICIPANTS = {
  none: 'not_found',
  player: 'allow',
  co_captain: 'allow',
  captain: 'allow',
  guest: 'allow',
  applicant: 'not_found',
} as const satisfies Record<Relation, Cell>;

/** Outsiders join; existing members or match participants get 409 `already_participant`. */
const OUTSIDERS_JOIN = {
  none: 'allow',
  player: 'already_participant',
  co_captain: 'already_participant',
  captain: 'already_participant',
  guest: 'already_participant',
  applicant: 'allow',
} as const satisfies Record<Relation, Cell>;

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

/** One rule per policy action. Keys mirror the "Policy action" column of the matrix. */
export const POLICY_RULES = {
  // §3.1 Auth
  'auth.register': { kind: 'public' },
  'auth.login': { kind: 'public' },
  'auth.refresh': { kind: 'public' },
  'auth.logout': { kind: 'authenticated' },
  'auth.verifyEmail': { kind: 'public' },
  'auth.forgot': { kind: 'public' },
  'auth.reset': { kind: 'public' },
  'auth.apple': { kind: 'public' },
  'auth.google': { kind: 'public' },

  // §3.2 Self
  'me.read': { kind: 'authenticated' },
  'me.update': { kind: 'authenticated' },
  'me.delete': { kind: 'authenticated', reauth: 'withStaffTotp' },
  'pushToken.register': { kind: 'authenticated' },

  // §3.3 Teams, invites, members
  'team.list': { kind: 'authenticated' },
  'team.create': { kind: 'authenticated', verified: true, entitlement: 'ownedTeamLimit' },
  'team.read': { kind: 'related', scope: 'team', cells: MEMBERS_READ },
  'team.update': {
    kind: 'related',
    scope: 'team',
    cells: TEAM_STAFF_WRITE,
    entitlement: 'teamNotProLocked',
  },
  'team.delete': {
    kind: 'related',
    scope: 'team',
    cells: { ...TEAM_STAFF_WRITE, co_captain: 'forbidden' },
  },
  'invite.create': {
    kind: 'related',
    scope: 'team',
    cells: TEAM_STAFF_WRITE,
    verified: true,
    entitlement: 'teamNotProLocked',
  },
  'invite.list': { kind: 'related', scope: 'team', cells: TEAM_STAFF_WRITE },
  'invite.revoke': { kind: 'related', scope: 'team', cells: TEAM_STAFF_WRITE },
  'invite.preview': { kind: 'public' },
  'invite.accept': { kind: 'related', scope: 'team', cells: OUTSIDERS_JOIN, verified: true },
  'member.updateRole': {
    kind: 'related',
    scope: 'team',
    cells: { ...TEAM_STAFF_WRITE, co_captain: 'forbidden', captain: captainSetsRole },
  },
  'member.remove': {
    kind: 'related',
    scope: 'team',
    cells: {
      ...TEAM_STAFF_WRITE,
      player: playerRemoves,
      co_captain: coCaptainRemoves,
      captain: captainRemoves,
    },
  },

  // §3.4 Matches, RSVP, lineup, payments, MVP
  'match.list': { kind: 'related', scope: 'team', cells: MEMBERS_READ },
  'match.create': {
    kind: 'related',
    scope: 'team',
    cells: TEAM_STAFF_WRITE,
    entitlement: 'teamNotProLocked',
  },
  'match.read': { kind: 'related', scope: 'match', cells: MATCH_PARTICIPANTS },
  'match.update': { kind: 'related', scope: 'match', cells: MATCH_STAFF_WRITE },
  'match.delete': { kind: 'related', scope: 'match', cells: MATCH_STAFF_WRITE },
  'rsvp.set': { kind: 'related', scope: 'match', cells: MATCH_PARTICIPANTS },
  'lineup.set': { kind: 'related', scope: 'match', cells: MATCH_STAFF_WRITE },
  'payment.mark': {
    kind: 'related',
    scope: 'match',
    cells: { ...MATCH_STAFF_WRITE, co_captain: coCaptainMarksPayment },
  },
  'mvp.vote': { kind: 'related', scope: 'match', cells: MATCH_PARTICIPANTS },

  // §3.5 Open calls and applications
  'opencall.list': { kind: 'public' },
  'opencall.publish': {
    kind: 'related',
    scope: 'match',
    cells: MATCH_STAFF_WRITE,
    entitlement: 'teamNotProLocked',
  },
  'opencall.close': { kind: 'related', scope: 'match', cells: MATCH_STAFF_WRITE },
  'application.create': { kind: 'related', scope: 'match', cells: OUTSIDERS_JOIN, verified: true },
  'application.decide': {
    kind: 'related',
    scope: 'application',
    cells: {
      none: 'not_found',
      player: 'not_found',
      co_captain: 'allow',
      captain: 'allow',
      guest: 'not_found',
      applicant: 'forbidden',
    },
  },
  'application.withdraw': {
    kind: 'related',
    scope: 'application',
    cells: {
      none: 'not_found',
      player: 'not_found',
      co_captain: 'forbidden',
      captain: 'forbidden',
      guest: 'not_found',
      applicant: 'allow',
    },
  },

  'application.list': {
    kind: 'related',
    scope: 'application',
    rows: true,
    precedence: 'staff',
    cells: {
      none: 'not_found',
      player: 'not_found',
      co_captain: 'allow',
      captain: 'allow',
      guest: 'not_found',
      applicant: 'allow',
    },
  },

  // §3.6 Venues and reviews
  'venue.list': { kind: 'public' },
  'venue.read': { kind: 'publicVenue' },
  'venue.create': { kind: 'authenticated', verified: true },
  'review.create': { kind: 'venue', verified: true, eligibility: 'playedAtVenue' },
  'review.deleteOwn': { kind: 'owned', venue: true },

  // §3.7 Uploads, webhooks
  'upload.presign.avatar': { kind: 'authenticated' },
  'upload.presign.badge': { kind: 'related', scope: 'team', cells: TEAM_STAFF_WRITE },
  'upload.complete': { kind: 'owned' },
  'upload.read': { kind: 'owned' },
  'webhook.revenuecat': { kind: 'public' },

  // §3.8 Admin
  'admin.stepUp': { kind: 'admin', tier: 'staff', stepUp: 'establish' },
  'admin.totpEnroll': { kind: 'admin', tier: 'staff', stepUp: 'establish', reauth: true },
  'admin.read': { kind: 'admin', tier: 'staff', stepUp: 'required' },
  'venue.verify': { kind: 'admin', tier: 'staff', stepUp: 'required' },
  'review.delete': { kind: 'admin', tier: 'staff', stepUp: 'required' },
  'opencall.remove': { kind: 'admin', tier: 'staff', stepUp: 'required' },
  'venue.import': { kind: 'admin', tier: 'admin', stepUp: 'required' },
  'admin.role.manage': {
    kind: 'admin',
    tier: 'admin',
    stepUp: 'required',
    freshTotp: true,
    noSelfTarget: true,
  },
  'admin.user.deactivate': {
    kind: 'admin',
    tier: 'admin',
    stepUp: 'required',
    freshTotp: true,
    noSelfTarget: true,
  },
  'admin.audit.read': { kind: 'admin', tier: 'admin', stepUp: 'required' },
} as const satisfies Record<Action, Rule>;

const RULES: ReadonlyMap<Action, Rule> = new Map(Object.entries(POLICY_RULES) as [Action, Rule][]);

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface PolicyOptions {
  /** Clock used for the step-up window; defaults to the current time. */
  now?: Date;
}

function isStaff(role: PlatformRole | null): boolean {
  return role === 'moderator' || role === 'admin';
}

function hasValidStepUp(actor: ActorContext, now: Date): boolean {
  return actor.stepUpUntil !== null && actor.stepUpUntil.getTime() > now.getTime();
}

/** 401 for a missing, incomplete or deactivated principal; `null` when authenticated. */
function authenticationFailure(actor: ActorContext): Decision | null {
  if (actor.userId === null || actor.platformRole === null) {
    return UNAUTHENTICATED;
  }
  return actor.deactivated ? DEACTIVATED : null;
}

function relationOf(
  action: Action,
  scope: Scope,
  resource: ResourceContext,
  precedence?: 'staff',
): Relation {
  const ctx = { action, resource };
  if (resource.teamRole === undefined) {
    throw new PolicyContextError(action, 'teamRole');
  }
  const isStaffRole = resource.teamRole === 'captain' || resource.teamRole === 'co_captain';
  if (scope === 'application' && !(precedence === 'staff' && isStaffRole)) {
    if (fact(ctx, 'isApplicant')) {
      return 'applicant';
    }
  }
  if (resource.teamRole !== null) {
    return resource.teamRole;
  }
  if (scope !== 'team' && fact(ctx, 'isMatchGuest')) {
    return 'guest';
  }
  return 'none';
}

function cellFor(cells: Readonly<Record<Relation, Cell>>, relation: Relation): Cell {
  switch (relation) {
    case 'none':
      return cells.none;
    case 'player':
      return cells.player;
    case 'co_captain':
      return cells.co_captain;
    case 'captain':
      return cells.captain;
    case 'guest':
      return cells.guest;
    case 'applicant':
      return cells.applicant;
  }
}

function resolveCell(cell: Cell, ctx: CellContext): Decision {
  switch (cell) {
    case 'allow':
      return ALLOW;
    case 'forbidden':
      return FORBIDDEN;
    case 'not_found':
      return NOT_FOUND;
    case 'already_participant':
      return ALREADY_PARTICIPANT;
    default:
      return cell(ctx);
  }
}

function entitlementFailure(
  entitlement: Entitlement | undefined,
  ctx: CellContext,
): Decision | null {
  switch (entitlement) {
    case undefined:
      return null;
    case 'ownedTeamLimit':
      return fact(ctx, 'actorOwnedTeams') >= 1 && !ctx.actor.isPro ? ENTITLEMENT_REQUIRED : null;
    case 'teamNotProLocked':
      return fact(ctx, 'teamProLocked') ? ENTITLEMENT_REQUIRED : null;
  }
}

function evaluateRelated(rule: Extract<Rule, { kind: 'related' }>, ctx: CellContext): Decision {
  const relation = relationOf(ctx.action, rule.scope, ctx.resource, rule.precedence);
  const cell = cellFor(rule.cells, relation);
  if (cell === 'not_found') {
    return NOT_FOUND;
  }
  if (rule.verified && !ctx.actor.emailVerified) {
    return EMAIL_UNVERIFIED;
  }
  const decision = resolveCell(cell, ctx);
  if (!decision.allow) {
    return decision;
  }
  const blocked = entitlementFailure(rule.entitlement, ctx);
  if (blocked !== null) {
    return blocked;
  }
  if (rule.rows) {
    return { allow: true, rows: relation === 'applicant' ? 'own' : 'all' };
  }
  if (rule.scope === 'match') {
    return { allow: true, projection: relation === 'guest' ? 'guest' : 'member' };
  }
  return ALLOW;
}

function evaluateVenue(rule: Extract<Rule, { kind: 'venue' }>, ctx: CellContext): Decision {
  if (!venueReadable(ctx, true)) {
    return NOT_FOUND;
  }
  if (rule.verified && !ctx.actor.emailVerified) {
    return EMAIL_UNVERIFIED;
  }
  if (rule.eligibility === 'playedAtVenue' && !fact(ctx, 'playedAtVenue')) {
    return REVIEW_NOT_ELIGIBLE;
  }
  return ALLOW;
}

function evaluateOwned(rule: Extract<Rule, { kind: 'owned' }>, ctx: CellContext): Decision {
  if (rule.venue && !venueReadable(ctx, true)) {
    return NOT_FOUND;
  }
  return fact(ctx, 'ownsResource') ? ALLOW : NOT_FOUND;
}

function evaluateAuthenticated(
  rule: Extract<Rule, { kind: 'authenticated' }>,
  ctx: CellContext,
): Decision {
  if (rule.reauth !== undefined) {
    if (!fact(ctx, 'reauthenticated')) {
      return REAUTH_REQUIRED;
    }
    if (isStaff(ctx.actor.platformRole) && !fact(ctx, 'freshTotp')) {
      return STEP_UP_REQUIRED;
    }
  }
  if (rule.verified && !ctx.actor.emailVerified) {
    return EMAIL_UNVERIFIED;
  }
  return entitlementFailure(rule.entitlement, ctx) ?? ALLOW;
}

function venueReadable(ctx: CellContext, actorIsActive: boolean): boolean {
  if (fact(ctx, 'venuePublic')) {
    return true;
  }
  return actorIsActive && ctx.resource.isCreator === true;
}

function evaluateAdmin(
  rule: Extract<Rule, { kind: 'admin' }>,
  ctx: CellContext,
  now: Date,
): Decision {
  const { actor } = ctx;
  if (!isStaff(actor.platformRole)) {
    return FORBIDDEN;
  }
  if (rule.stepUp === 'required' && !hasValidStepUp(actor, now)) {
    return STEP_UP_REQUIRED;
  }
  if (rule.tier === 'admin' && actor.platformRole !== 'admin') {
    return FORBIDDEN;
  }
  if (rule.freshTotp && !fact(ctx, 'freshTotp')) {
    return STEP_UP_REQUIRED;
  }
  if (rule.noSelfTarget && fact(ctx, 'isSelf')) {
    return FORBIDDEN;
  }
  if (rule.reauth && !fact(ctx, 'reauthenticated')) {
    return REAUTH_REQUIRED;
  }
  return ALLOW;
}

/**
 * Decides whether `actor` may perform `action` on the resource described by `resource`.
 * Never throws for a denial; throws {@link PolicyContextError} only when a required resource fact
 * is missing, which is a programming error in the calling handler.
 */
export function can(
  actor: ActorContext,
  action: Action,
  resource: ResourceContext = {},
  options: PolicyOptions = {},
): Decision {
  const rule = RULES.get(action);
  if (rule === undefined) {
    throw new RangeError(`Unknown policy action "${String(action)}"`);
  }
  const ctx: CellContext = { action, actor, resource };

  switch (rule.kind) {
    case 'public':
      return ALLOW;
    case 'publicVenue':
      return venueReadable(ctx, authenticationFailure(actor) === null) ? ALLOW : NOT_FOUND;
    default:
      break;
  }

  const unauthenticated = authenticationFailure(actor);
  if (unauthenticated !== null) {
    return unauthenticated;
  }

  switch (rule.kind) {
    case 'authenticated':
      return evaluateAuthenticated(rule, ctx);
    case 'venue':
      return evaluateVenue(rule, ctx);
    case 'owned':
      return evaluateOwned(rule, ctx);
    case 'related':
      return evaluateRelated(rule, ctx);
    case 'admin':
      return evaluateAdmin(rule, ctx, options.now ?? new Date());
  }
}
