import { z } from 'zod';

import {
  adminIdParamsSchema,
  adminOpenCallSchema,
  adminReviewSchema,
  adminStepUpRequestSchema,
  adminStepUpResponseSchema,
  adminTotpConfirmRequestSchema,
  adminTotpEnrollRequestSchema,
  adminTotpEnrollResponseSchema,
  adminUserSchema,
  adminVenueSchema,
  auditLogEntrySchema,
  listAdminOpenCallsQuerySchema,
  listAdminReviewsQuerySchema,
  listAdminUsersQuerySchema,
  listAdminVenuesQuerySchema,
  listAuditLogsQuerySchema,
  setUserDeactivatedRequestSchema,
  setUserRoleRequestSchema,
  updateAdminVenueRequestSchema,
  venueImportParamsSchema,
  venueImportRequestSchema,
  venueImportSchema,
} from './admin.js';
import {
  appleSignInRequestSchema,
  type AuthClient,
  forgotPasswordRequestSchema,
  googleSignInRequestSchema,
  loginRequestSchema,
  LOGOUT_REQUEST_SCHEMAS,
  mobileAuthResponseSchema,
  mobileRefreshResponseSchema,
  REFRESH_REQUEST_SCHEMAS,
  registerRequestSchema,
  resetPasswordRequestSchema,
  verifyEmailRequestSchema,
  webAuthResponseSchema,
  webRefreshResponseSchema,
} from './auth.js';
import { revenueCatWebhookBodySchema, revenueCatWebhookResponseSchema } from './billing.js';
import { acceptedResponseSchema } from './common.js';
import { listDistrictsQuerySchema, listDistrictsResponseSchema } from './districts.js';
import { healthResponseSchema } from './health.js';
import {
  createMatchRequestSchema,
  deleteMatchResponseSchema,
  lineupResponseSchema,
  listMatchesQuerySchema,
  markPaymentRequestSchema,
  matchDetailSchema,
  matchParamsSchema,
  matchPaymentParamsSchema,
  matchSummarySchema,
  mvpVoteRequestSchema,
  mvpVoteResponseSchema,
  ownRsvpSchema,
  paymentResponseSchema,
  setLineupRequestSchema,
  setRsvpRequestSchema,
  updateMatchRequestSchema,
} from './matches.js';
import {
  applicationParamsSchema,
  applicationSchema,
  closeOpenCallRequestSchema,
  createApplicationRequestSchema,
  listApplicationsQuerySchema,
  decideApplicationRequestSchema,
  listOpenCallsQuerySchema,
  openCallParamsSchema,
  openCallPublicSchema,
  openCallSchema,
  publishOpenCallRequestSchema,
} from './open-calls.js';
import { paginatedResponseSchema, paginationQuerySchema } from './pagination.js';
import { type ErrorCode } from './problem.js';
import { type RateLimitGroup } from './rate-limits.js';
import { type Action } from './roles.js';
import {
  acceptInviteRequestSchema,
  acceptInviteResponseSchema,
  createInviteRequestSchema,
  createInviteResponseSchema,
  createTeamRequestSchema,
  inviteCodeParamsSchema,
  invitePreviewSchema,
  teamDetailSchema,
  teamInviteParamsSchema,
  teamInviteSchema,
  teamMemberParamsSchema,
  teamMemberSchema,
  teamParamsSchema,
  teamSummarySchema,
  updateMemberRoleRequestSchema,
  updateTeamRequestSchema,
} from './teams.js';
import {
  completeUploadRequestSchema,
  completeUploadResponseSchema,
  presignUploadRequestSchema,
  presignUploadResponseSchema,
  uploadParamsSchema,
  uploadStatusResponseSchema,
} from './uploads.js';
import {
  deleteAccountRequestSchema,
  deleteAccountResponseSchema,
  meResponseSchema,
  meStatsResponseSchema,
  registerPushTokenRequestSchema,
  updateMeRequestSchema,
} from './users.js';
import {
  createReviewRequestSchema,
  createVenueRequestSchema,
  listVenuesQuerySchema,
  venueDetailSchema,
  venueParamsSchema,
  venueReviewSchema,
  venueSummarySchema,
} from './venues.js';

/**
 * Endpoint registry: the single source of truth for every `/api/v1` operation. Web Route
 * Handlers take method, path, client rule, auth mode, schemas and rate-limit group from here,
 * the OpenAPI document is generated from it, and tests prove that it matches the authorization
 * matrix action by action.
 */

export const API_PREFIX = '/api/v1';

export const ENDPOINT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type EndpointMethod = (typeof ENDPOINT_METHODS)[number];

/** `required`: `x-kadro-client` must be sent (ADR-0014); `exempt`: health and webhook only (ADR-0020). */
export type ClientRule = 'required' | 'exempt';

/**
 * `required`: 401 without valid credentials. `optional`: public read; credentials are verified
 * when present (creator visibility). `none`: credentials are never read.
 */
export type AuthMode = 'required' | 'optional' | 'none';

/** A schema, or one schema per client type selected by `x-kadro-client` (ADR-0014). */
export type SchemaSpec = z.ZodType | { readonly byClient: Readonly<Record<AuthClient, z.ZodType>> };

/**
 * The `can()` action a handler authorizes. A few operations select the action from a body field
 * (`PATCH open-calls/:id/applications/:appId` by `status`, `POST uploads/presign` by `kind`);
 * `health` is not a policy action.
 */
export type EndpointPolicy =
  | { readonly action: Action }
  | {
      readonly selectBy: 'body.status' | 'body.kind';
      readonly actions: Readonly<Record<string, Action>>;
    }
  | { readonly action: null; readonly reason: string };

export type SuccessStatus = 200 | 201 | 202 | 204;

/** Delivery phases of the product spec that add API endpoints. */
export const ENDPOINT_PHASES = [1, 2, 3, 4, 5] as const;
export type EndpointPhase = (typeof ENDPOINT_PHASES)[number];

export interface EndpointResponse {
  readonly status: SuccessStatus;
  readonly description: string;
  /** `null` for 204 responses. */
  readonly schema: SchemaSpec | null;
}

export const ENDPOINT_TAGS = [
  'health',
  'auth',
  'me',
  'districts',
  'teams',
  'matches',
  'open-calls',
  'venues',
  'uploads',
  'webhooks',
  'admin',
] as const;
export type EndpointTag = (typeof ENDPOINT_TAGS)[number];

export interface EndpointDefinition {
  /** Stable operation id, also the OpenAPI `operationId`. */
  readonly id: string;
  readonly summary: string;
  readonly description?: string;
  readonly tag: EndpointTag;
  /** Delivery phase of the product spec in which the endpoint ships. */
  readonly phase: EndpointPhase;
  readonly method: EndpointMethod;
  /** Next.js route pattern, identical to the file location (`/api/v1/teams/[id]`). */
  readonly path: `/api/v1/${string}`;
  readonly client: ClientRule;
  readonly auth: AuthMode;
  readonly policy: EndpointPolicy;
  /** Matrix cell marked **V**: 403 `email_unverified` without a verified email. */
  readonly emailVerified: boolean;
  /**
   * Admin route behind the TOTP step-up window (authorization matrix §3.8): 401
   * `step_up_required` without a valid step-up. Absent means `false`.
   */
  readonly stepUp?: boolean;
  readonly params: z.ZodObject;
  readonly query: z.ZodObject;
  /** Required for POST / PUT / PATCH, `null` for GET; DELETE may have either. */
  readonly body: SchemaSpec | null;
  readonly response: EndpointResponse;
  /** Codes this operation produces beyond the ones implied by its definition (see `endpointErrorCodes`). */
  readonly errors: readonly ErrorCode[];
  /**
   * Group of authorization matrix §8; `null` for reads, which are not limited per group, except
   * the invite preview (group I against code probing).
   */
  readonly rateLimit: RateLimitGroup | null;
}

const noParams = z.strictObject({});
const noQuery = z.strictObject({});

function defineEndpoint<const T extends EndpointDefinition>(definition: T): T {
  return definition;
}

// ---------------------------------------------------------------------------
// Phase 1: health, auth, me
// ---------------------------------------------------------------------------

const AUTH_BY_CLIENT = {
  byClient: { mobile: mobileAuthResponseSchema, web: webAuthResponseSchema },
};

const SIGN_IN_NOTE =
  'A sign-in with valid credentials during a self-initiated deletion grace period cancels the ' +
  'deletion and reactivates the account (ADR-0012); this is the only way to cancel a deletion, ' +
  'because a deactivated account has no usable session.';

export const ENDPOINTS = {
  getHealth: defineEndpoint({
    id: 'getHealth',
    summary: 'Uptime probe: status and build SHA, no secrets',
    tag: 'health',
    phase: 1,
    method: 'GET',
    path: '/api/v1/health',
    client: 'exempt',
    auth: 'none',
    policy: { action: null, reason: 'health.read is not a policy action (matrix §3.7)' },
    emailVerified: false,
    params: noParams,
    query: noQuery,
    body: null,
    response: { status: 200, description: 'Service is up', schema: healthResponseSchema },
    errors: [],
    rateLimit: null,
  }),
  register: defineEndpoint({
    id: 'register',
    summary: 'Register with email and password',
    description:
      'Always 202 with an identical body and no session, whether or not the email exists ' +
      '(ADR-0015). A breached password is refused with 422.',
    tag: 'auth',
    phase: 1,
    method: 'POST',
    path: '/api/v1/auth/register',
    client: 'required',
    auth: 'none',
    policy: { action: 'auth.register' },
    emailVerified: false,
    params: noParams,
    query: noQuery,
    body: registerRequestSchema,
    response: { status: 202, description: 'Accepted', schema: acceptedResponseSchema },
    errors: ['password_breached'],
    rateLimit: 'A',
  }),
  login: defineEndpoint({
    id: 'login',
    summary: 'Sign in with email and password',
    description: `Mobile receives tokens; web receives the session and CSRF cookies. ${SIGN_IN_NOTE}`,
    tag: 'auth',
    phase: 1,
    method: 'POST',
    path: '/api/v1/auth/login',
    client: 'required',
    auth: 'none',
    policy: { action: 'auth.login' },
    emailVerified: false,
    params: noParams,
    query: noQuery,
    body: loginRequestSchema,
    response: { status: 200, description: 'Signed in', schema: AUTH_BY_CLIENT },
    errors: ['invalid_credentials', 'account_deactivated'],
    rateLimit: 'A',
  }),
  refresh: defineEndpoint({
    id: 'refresh',
    summary: 'Rotate the refresh token (mobile) or session cookie (web)',
    description:
      'Reuse of a rotated token revokes the whole family (ADR-0019). Web sends an empty body, ' +
      'the session cookie and the CSRF header.',
    tag: 'auth',
    phase: 1,
    method: 'POST',
    path: '/api/v1/auth/refresh',
    client: 'required',
    auth: 'none',
    policy: { action: 'auth.refresh' },
    emailVerified: false,
    params: noParams,
    query: noQuery,
    body: { byClient: REFRESH_REQUEST_SCHEMAS },
    response: {
      status: 200,
      description: 'Rotated',
      schema: { byClient: { mobile: mobileRefreshResponseSchema, web: webRefreshResponseSchema } },
    },
    errors: ['unauthenticated', 'account_deactivated', 'csrf_failed'],
    rateLimit: 'R',
  }),
  logout: defineEndpoint({
    id: 'logout',
    summary: 'Revoke the presented session family',
    tag: 'auth',
    phase: 1,
    method: 'POST',
    path: '/api/v1/auth/logout',
    client: 'required',
    auth: 'required',
    policy: { action: 'auth.logout' },
    emailVerified: false,
    params: noParams,
    query: noQuery,
    body: { byClient: LOGOUT_REQUEST_SCHEMAS },
    response: { status: 204, description: 'Signed out', schema: null },
    errors: [],
    rateLimit: 'G',
  }),
  verifyEmail: defineEndpoint({
    id: 'verifyEmail',
    summary: 'Redeem a single-use email verification token',
    tag: 'auth',
    phase: 1,
    method: 'POST',
    path: '/api/v1/auth/verify-email',
    client: 'required',
    auth: 'none',
    policy: { action: 'auth.verifyEmail' },
    emailVerified: false,
    params: noParams,
    query: noQuery,
    body: verifyEmailRequestSchema,
    response: { status: 204, description: 'Email verified', schema: null },
    errors: ['token_invalid'],
    rateLimit: 'A',
  }),
  forgotPassword: defineEndpoint({
    id: 'forgotPassword',
    summary: 'Request a password reset email',
    description: 'Always 202 with an identical body (ADR-0015).',
    tag: 'auth',
    phase: 1,
    method: 'POST',
    path: '/api/v1/auth/forgot',
    client: 'required',
    auth: 'none',
    policy: { action: 'auth.forgot' },
    emailVerified: false,
    params: noParams,
    query: noQuery,
    body: forgotPasswordRequestSchema,
    response: { status: 202, description: 'Accepted', schema: acceptedResponseSchema },
    errors: [],
    rateLimit: 'A',
  }),
  resetPassword: defineEndpoint({
    id: 'resetPassword',
    summary: 'Set a new password with a reset token',
    description: 'Revokes every refresh token and session of the user.',
    tag: 'auth',
    phase: 1,
    method: 'POST',
    path: '/api/v1/auth/reset',
    client: 'required',
    auth: 'none',
    policy: { action: 'auth.reset' },
    emailVerified: false,
    params: noParams,
    query: noQuery,
    body: resetPasswordRequestSchema,
    response: { status: 204, description: 'Password changed', schema: null },
    errors: ['token_invalid', 'password_breached'],
    rateLimit: 'A',
  }),
  signInWithApple: defineEndpoint({
    id: 'signInWithApple',
    summary: 'Sign in with Apple (identity token, nonce-bound)',
    description: SIGN_IN_NOTE,
    tag: 'auth',
    phase: 1,
    method: 'POST',
    path: '/api/v1/auth/apple',
    client: 'required',
    auth: 'none',
    policy: { action: 'auth.apple' },
    emailVerified: false,
    params: noParams,
    query: noQuery,
    body: appleSignInRequestSchema,
    response: { status: 200, description: 'Signed in', schema: AUTH_BY_CLIENT },
    errors: ['token_invalid', 'account_link_required', 'account_deactivated'],
    rateLimit: 'A',
  }),
  signInWithGoogle: defineEndpoint({
    id: 'signInWithGoogle',
    summary: 'Sign in with Google (ID token)',
    description: SIGN_IN_NOTE,
    tag: 'auth',
    phase: 1,
    method: 'POST',
    path: '/api/v1/auth/google',
    client: 'required',
    auth: 'none',
    policy: { action: 'auth.google' },
    emailVerified: false,
    params: noParams,
    query: noQuery,
    body: googleSignInRequestSchema,
    response: { status: 200, description: 'Signed in', schema: AUTH_BY_CLIENT },
    errors: ['token_invalid', 'account_link_required', 'account_deactivated'],
    rateLimit: 'A',
  }),
  getMe: defineEndpoint({
    id: 'getMe',
    summary: "The caller's own profile",
    tag: 'me',
    phase: 1,
    method: 'GET',
    path: '/api/v1/me',
    client: 'required',
    auth: 'required',
    policy: { action: 'me.read' },
    emailVerified: false,
    params: noParams,
    query: noQuery,
    body: null,
    response: { status: 200, description: 'Own profile', schema: meResponseSchema },
    errors: [],
    rateLimit: null,
  }),
  updateMe: defineEndpoint({
    id: 'updateMe',
    summary: 'Update the self-writable profile fields',
    tag: 'me',
    phase: 1,
    method: 'PATCH',
    path: '/api/v1/me',
    client: 'required',
    auth: 'required',
    policy: { action: 'me.update' },
    emailVerified: false,
    params: noParams,
    query: noQuery,
    body: updateMeRequestSchema,
    response: { status: 200, description: 'Updated profile', schema: meResponseSchema },
    errors: [],
    rateLimit: 'G',
  }),
  deleteMe: defineEndpoint({
    id: 'deleteMe',
    summary: 'Start account deletion (7-day grace period)',
    description:
      'Requires a single-use re-authentication proof, plus a fresh TOTP code for staff. The ' +
      'account is deactivated immediately: sessions revoked, push tokens deleted, upcoming RSVPs ' +
      'set to out (ADR-0032). Signing in again before `graceUntil` cancels the deletion ' +
      '(ADR-0012); there is no separate cancel endpoint because a deactivated account has no ' +
      'usable session.',
    tag: 'me',
    phase: 2,
    method: 'DELETE',
    path: '/api/v1/me',
    client: 'required',
    auth: 'required',
    policy: { action: 'me.delete' },
    emailVerified: false,
    params: noParams,
    query: noQuery,
    body: deleteAccountRequestSchema,
    response: {
      status: 202,
      description: 'Deletion scheduled',
      schema: deleteAccountResponseSchema,
    },
    errors: ['reauth_required', 'step_up_required', 'last_admin', 'deletion_pending'],
    rateLimit: 'D',
  }),
  registerPushToken: defineEndpoint({
    id: 'registerPushToken',
    summary: 'Register an Expo push token for the caller',
    description:
      'A token already bound to another user is re-bound to the caller; the old binding is deleted.',
    tag: 'me',
    phase: 2,
    method: 'POST',
    path: '/api/v1/me/push-tokens',
    client: 'required',
    auth: 'required',
    policy: { action: 'pushToken.register' },
    emailVerified: false,
    params: noParams,
    query: noQuery,
    body: registerPushTokenRequestSchema,
    response: { status: 204, description: 'Registered', schema: null },
    errors: [],
    rateLimit: 'P',
  }),
  getMyStats: defineEndpoint({
    id: 'getMyStats',
    summary: "The caller's profile statistics (basic, or full for Pro)",
    description:
      'Matches played and MVP count for everyone; the `advanced` block only when the caller holds ' +
      'Pro at request time (authorization matrix §7). Entitlement comes from `subscriptions` only.',
    tag: 'me',
    phase: 3,
    method: 'GET',
    path: '/api/v1/me/stats',
    client: 'required',
    auth: 'required',
    policy: { action: 'me.read' },
    emailVerified: false,
    params: noParams,
    query: noQuery,
    body: null,
    response: { status: 200, description: 'Own statistics', schema: meStatsResponseSchema },
    errors: [],
    rateLimit: null,
  }),

  // -------------------------------------------------------------------------
  // Districts (reference data)
  // -------------------------------------------------------------------------
  listDistricts: defineEndpoint({
    id: 'listDistricts',
    summary: 'Provinces and districts (il / ilçe) with their slugs and centroids',
    description:
      'Public reference data for pickers and maps; not paginated. `province` narrows the list ' +
      'to one il. Cacheable for a day.',
    tag: 'districts',
    phase: 3,
    method: 'GET',
    path: '/api/v1/districts',
    client: 'required',
    auth: 'none',
    policy: {
      action: null,
      reason: 'public reference data; no policy action (like health.read, matrix §3.7)',
    },
    emailVerified: false,
    params: noParams,
    query: listDistrictsQuerySchema,
    body: null,
    response: { status: 200, description: 'Districts', schema: listDistrictsResponseSchema },
    errors: [],
    rateLimit: null,
  }),

  // -------------------------------------------------------------------------
  // Teams, invites, members
  // -------------------------------------------------------------------------
  listTeams: defineEndpoint({
    id: 'listTeams',
    summary: 'Teams the caller is a member of',
    tag: 'teams',
    phase: 2,
    method: 'GET',
    path: '/api/v1/teams',
    client: 'required',
    auth: 'required',
    policy: { action: 'team.list' },
    emailVerified: false,
    params: noParams,
    query: paginationQuerySchema,
    body: null,
    response: {
      status: 200,
      description: 'Page of own teams',
      schema: paginatedResponseSchema(teamSummarySchema),
    },
    errors: ['invalid_cursor'],
    rateLimit: null,
  }),
  createTeam: defineEndpoint({
    id: 'createTeam',
    summary: 'Create a team; the caller becomes its captain',
    description: 'Free tier: one owned team; a second requires Pro (403 `entitlement_required`).',
    tag: 'teams',
    phase: 2,
    method: 'POST',
    path: '/api/v1/teams',
    client: 'required',
    auth: 'required',
    policy: { action: 'team.create' },
    emailVerified: true,
    params: noParams,
    query: noQuery,
    body: createTeamRequestSchema,
    response: { status: 201, description: 'Team created', schema: teamDetailSchema },
    errors: ['entitlement_required'],
    rateLimit: 'G',
  }),
  getTeam: defineEndpoint({
    id: 'getTeam',
    summary: 'Team with roster (members only)',
    tag: 'teams',
    phase: 2,
    method: 'GET',
    path: '/api/v1/teams/[id]',
    client: 'required',
    auth: 'required',
    policy: { action: 'team.read' },
    emailVerified: false,
    params: teamParamsSchema,
    query: noQuery,
    body: null,
    response: { status: 200, description: 'Team', schema: teamDetailSchema },
    errors: ['not_found'],
    rateLimit: null,
  }),
  updateTeam: defineEndpoint({
    id: 'updateTeam',
    summary: 'Update name, district or badge (captain, co-captain)',
    tag: 'teams',
    phase: 2,
    method: 'PATCH',
    path: '/api/v1/teams/[id]',
    client: 'required',
    auth: 'required',
    policy: { action: 'team.update' },
    emailVerified: false,
    params: teamParamsSchema,
    query: noQuery,
    body: updateTeamRequestSchema,
    response: { status: 200, description: 'Updated team', schema: teamDetailSchema },
    errors: ['not_found', 'forbidden', 'entitlement_required'],
    rateLimit: 'G',
  }),
  deleteTeam: defineEndpoint({
    id: 'deleteTeam',
    summary: 'Delete the team (captain only)',
    description:
      'A team with at least one `played` match and any member besides the captain cannot be deleted (409 `team_has_history`); the captain transfers captaincy and leaves instead. A team whose only member is the captain is deleted with its matches. `cancelled` matches do not count as played.',
    tag: 'teams',
    phase: 2,
    method: 'DELETE',
    path: '/api/v1/teams/[id]',
    client: 'required',
    auth: 'required',
    policy: { action: 'team.delete' },
    emailVerified: false,
    params: teamParamsSchema,
    query: noQuery,
    body: null,
    response: { status: 204, description: 'Team deleted', schema: null },
    errors: ['not_found', 'forbidden', 'team_has_history'],
    rateLimit: 'G',
  }),
  createInvite: defineEndpoint({
    id: 'createInvite',
    summary: 'Create an invite link (captain, co-captain)',
    description: 'The plaintext code is returned once and stored only as a hash (ADR-0011).',
    tag: 'teams',
    phase: 2,
    method: 'POST',
    path: '/api/v1/teams/[id]/invites',
    client: 'required',
    auth: 'required',
    policy: { action: 'invite.create' },
    emailVerified: true,
    params: teamParamsSchema,
    query: noQuery,
    body: createInviteRequestSchema,
    response: { status: 201, description: 'Invite created', schema: createInviteResponseSchema },
    errors: ['not_found', 'forbidden', 'entitlement_required', 'invite_limit'],
    rateLimit: 'G',
  }),
  listInvites: defineEndpoint({
    id: 'listInvites',
    summary: 'Invites of a team, without codes (captain, co-captain)',
    tag: 'teams',
    phase: 2,
    method: 'GET',
    path: '/api/v1/teams/[id]/invites',
    client: 'required',
    auth: 'required',
    policy: { action: 'invite.list' },
    emailVerified: false,
    params: teamParamsSchema,
    query: paginationQuerySchema,
    body: null,
    response: {
      status: 200,
      description: 'Page of invites',
      schema: paginatedResponseSchema(teamInviteSchema),
    },
    errors: ['not_found', 'forbidden', 'invalid_cursor'],
    rateLimit: null,
  }),
  revokeInvite: defineEndpoint({
    id: 'revokeInvite',
    summary: 'Revoke an invite (captain, co-captain; audited)',
    tag: 'teams',
    phase: 2,
    method: 'DELETE',
    path: '/api/v1/teams/[id]/invites/[inviteId]',
    client: 'required',
    auth: 'required',
    policy: { action: 'invite.revoke' },
    emailVerified: false,
    params: teamInviteParamsSchema,
    query: noQuery,
    body: null,
    response: { status: 204, description: 'Invite revoked', schema: null },
    errors: ['not_found', 'forbidden'],
    rateLimit: 'G',
  }),
  previewInvite: defineEndpoint({
    id: 'previewInvite',
    summary: 'What the invite landing page shows for a code',
    description:
      'Anonymous callers allowed. Invalid, expired, revoked and exhausted codes answer the same 404.',
    tag: 'teams',
    phase: 2,
    method: 'GET',
    path: '/api/v1/invites/[code]',
    client: 'required',
    auth: 'optional',
    policy: { action: 'invite.preview' },
    emailVerified: false,
    params: inviteCodeParamsSchema,
    query: noQuery,
    body: null,
    response: { status: 200, description: 'Invite preview', schema: invitePreviewSchema },
    errors: ['not_found'],
    rateLimit: 'I',
  }),
  acceptInvite: defineEndpoint({
    id: 'acceptInvite',
    summary: 'Join a team with an invite code',
    description:
      'Invalid, expired, revoked and exhausted codes all answer the same 404. Existing members ' +
      'get 409 `already_participant` without consuming a use (ADR-0034).',
    tag: 'teams',
    phase: 2,
    method: 'POST',
    path: '/api/v1/invites/[code]/accept',
    client: 'required',
    auth: 'required',
    policy: { action: 'invite.accept' },
    emailVerified: true,
    params: inviteCodeParamsSchema,
    query: noQuery,
    body: acceptInviteRequestSchema,
    response: { status: 200, description: 'Joined as player', schema: acceptInviteResponseSchema },
    errors: ['not_found', 'already_participant'],
    rateLimit: 'I',
  }),
  updateMemberRole: defineEndpoint({
    id: 'updateMemberRole',
    summary: "Change a member's role or transfer captaincy (captain only)",
    tag: 'teams',
    phase: 2,
    method: 'PATCH',
    path: '/api/v1/teams/[id]/members/[userId]',
    client: 'required',
    auth: 'required',
    policy: { action: 'member.updateRole' },
    emailVerified: false,
    params: teamMemberParamsSchema,
    query: noQuery,
    body: updateMemberRoleRequestSchema,
    response: { status: 200, description: 'Updated member', schema: teamMemberSchema },
    errors: ['not_found', 'forbidden', 'entitlement_required'],
    rateLimit: 'G',
  }),
  removeMember: defineEndpoint({
    id: 'removeMember',
    summary: 'Remove a member or leave the team',
    description:
      'The captain cannot leave (409 `captain_must_transfer`); co-captains remove players only.',
    tag: 'teams',
    phase: 2,
    method: 'DELETE',
    path: '/api/v1/teams/[id]/members/[userId]',
    client: 'required',
    auth: 'required',
    policy: { action: 'member.remove' },
    emailVerified: false,
    params: teamMemberParamsSchema,
    query: noQuery,
    body: null,
    response: { status: 204, description: 'Member removed', schema: null },
    errors: ['not_found', 'forbidden', 'captain_must_transfer'],
    rateLimit: 'G',
  }),

  // -------------------------------------------------------------------------
  // Matches, RSVP, lineup, payments, MVP
  // -------------------------------------------------------------------------
  listMatches: defineEndpoint({
    id: 'listMatches',
    summary: 'Matches of a team (members only)',
    tag: 'matches',
    phase: 2,
    method: 'GET',
    path: '/api/v1/teams/[id]/matches',
    client: 'required',
    auth: 'required',
    policy: { action: 'match.list' },
    emailVerified: false,
    params: teamParamsSchema,
    query: listMatchesQuerySchema,
    body: null,
    response: {
      status: 200,
      description: 'Page of matches',
      schema: paginatedResponseSchema(matchSummarySchema),
    },
    errors: ['not_found', 'invalid_cursor'],
    rateLimit: null,
  }),
  createMatch: defineEndpoint({
    id: 'createMatch',
    summary: 'Create a match (captain, co-captain)',
    tag: 'matches',
    phase: 2,
    method: 'POST',
    path: '/api/v1/teams/[id]/matches',
    client: 'required',
    auth: 'required',
    policy: { action: 'match.create' },
    emailVerified: false,
    params: teamParamsSchema,
    query: noQuery,
    body: createMatchRequestSchema,
    response: { status: 201, description: 'Match created', schema: matchDetailSchema },
    errors: ['not_found', 'forbidden', 'entitlement_required'],
    rateLimit: 'G',
  }),
  getMatch: defineEndpoint({
    id: 'getMatch',
    summary: 'Match detail: member or guest projection',
    tag: 'matches',
    phase: 2,
    method: 'GET',
    path: '/api/v1/matches/[id]',
    client: 'required',
    auth: 'required',
    policy: { action: 'match.read' },
    emailVerified: false,
    params: matchParamsSchema,
    query: noQuery,
    body: null,
    response: { status: 200, description: 'Match', schema: matchDetailSchema },
    errors: ['not_found'],
    rateLimit: null,
  }),
  updateMatch: defineEndpoint({
    id: 'updateMatch',
    summary: 'Edit a match or change its status (captain, co-captain)',
    description:
      '`slots` below the confirmed (`in`) count → 409 `slots_below_confirmed`; `slots` whose ' +
      '`ceil(slots / 2)` is below the players already on one lineup side → 409 ' +
      '`slots_below_lineup` (ADR-0035).',
    tag: 'matches',
    phase: 2,
    method: 'PATCH',
    path: '/api/v1/matches/[id]',
    client: 'required',
    auth: 'required',
    policy: { action: 'match.update' },
    emailVerified: false,
    params: matchParamsSchema,
    query: noQuery,
    body: updateMatchRequestSchema,
    response: { status: 200, description: 'Updated match', schema: matchDetailSchema },
    errors: [
      'not_found',
      'forbidden',
      'match_terms_frozen',
      'invalid_status_transition',
      'slots_below_confirmed',
      'slots_below_lineup',
    ],
    rateLimit: 'G',
  }),
  deleteMatch: defineEndpoint({
    id: 'deleteMatch',
    summary: 'Delete a draft or cancel an open / locked match',
    tag: 'matches',
    phase: 2,
    method: 'DELETE',
    path: '/api/v1/matches/[id]',
    client: 'required',
    auth: 'required',
    policy: { action: 'match.delete' },
    emailVerified: false,
    params: matchParamsSchema,
    query: noQuery,
    body: null,
    response: {
      status: 200,
      description: 'Deleted or cancelled',
      schema: deleteMatchResponseSchema,
    },
    errors: ['not_found', 'forbidden', 'match_state_conflict'],
    rateLimit: 'G',
  }),
  setRsvp: defineEndpoint({
    id: 'setRsvp',
    summary: 'Set own RSVP (in, out, maybe)',
    description:
      'Over-subscribed `in` becomes `waitlist`; in a locked match only `out` is accepted.',
    tag: 'matches',
    phase: 2,
    method: 'PUT',
    path: '/api/v1/matches/[id]/rsvp',
    client: 'required',
    auth: 'required',
    policy: { action: 'rsvp.set' },
    emailVerified: false,
    params: matchParamsSchema,
    query: noQuery,
    body: setRsvpRequestSchema,
    response: { status: 200, description: 'Own RSVP', schema: ownRsvpSchema },
    errors: ['not_found', 'match_not_open', 'match_full'],
    rateLimit: 'G',
  }),
  setLineup: defineEndpoint({
    id: 'setLineup',
    summary: 'Replace the lineup sides (captain, co-captain)',
    tag: 'matches',
    phase: 2,
    method: 'PUT',
    path: '/api/v1/matches/[id]/lineup',
    client: 'required',
    auth: 'required',
    policy: { action: 'lineup.set' },
    emailVerified: false,
    params: matchParamsSchema,
    query: noQuery,
    body: setLineupRequestSchema,
    response: { status: 200, description: 'Stored lineup', schema: lineupResponseSchema },
    errors: [
      'not_found',
      'forbidden',
      'lineup_invalid_player',
      'lineup_side_full',
      'match_state_conflict',
    ],
    rateLimit: 'G',
  }),
  markPayment: defineEndpoint({
    id: 'markPayment',
    summary: "Mark a player's share paid or unpaid (captain, co-captain; audited)",
    tag: 'matches',
    phase: 2,
    method: 'PATCH',
    path: '/api/v1/matches/[id]/payments/[userId]',
    client: 'required',
    auth: 'required',
    policy: { action: 'payment.mark' },
    emailVerified: false,
    params: matchPaymentParamsSchema,
    query: noQuery,
    body: markPaymentRequestSchema,
    response: { status: 200, description: 'Payment flag', schema: paymentResponseSchema },
    errors: ['not_found', 'forbidden', 'player_not_confirmed', 'match_state_conflict'],
    rateLimit: 'G',
  }),
  voteMvp: defineEndpoint({
    id: 'voteMvp',
    summary: 'Vote for the MVP within 24 hours of a played match',
    description:
      '409 `mvp_vote_closed` both after the window and on a match that is not `played` ' +
      '(the window has not opened); voter and votee must be confirmed players (ADR-0036).',
    tag: 'matches',
    phase: 2,
    method: 'POST',
    path: '/api/v1/matches/[id]/mvp-vote',
    client: 'required',
    auth: 'required',
    policy: { action: 'mvp.vote' },
    emailVerified: false,
    params: matchParamsSchema,
    query: noQuery,
    body: mvpVoteRequestSchema,
    response: { status: 201, description: 'Own vote recorded', schema: mvpVoteResponseSchema },
    errors: [
      'not_found',
      'mvp_vote_closed',
      'player_not_confirmed',
      'invalid_votee',
      'already_voted',
    ],
    rateLimit: 'G',
  }),

  // -------------------------------------------------------------------------
  // Open calls (Eksik Var) and applications
  // -------------------------------------------------------------------------
  listOpenCalls: defineEndpoint({
    id: 'listOpenCalls',
    summary: 'Public list of open calls, filterable by district, level and position',
    tag: 'open-calls',
    phase: 2,
    method: 'GET',
    path: '/api/v1/open-calls',
    client: 'required',
    auth: 'optional',
    policy: { action: 'opencall.list' },
    emailVerified: false,
    params: noParams,
    query: listOpenCallsQuerySchema,
    body: null,
    response: {
      status: 200,
      description: 'Page of open calls (public projection)',
      schema: paginatedResponseSchema(openCallPublicSchema),
    },
    errors: ['invalid_cursor'],
    rateLimit: null,
  }),
  publishOpenCall: defineEndpoint({
    id: 'publishOpenCall',
    summary: 'Publish an open call for a match (captain, co-captain)',
    tag: 'open-calls',
    phase: 2,
    method: 'POST',
    path: '/api/v1/matches/[id]/open-call',
    client: 'required',
    auth: 'required',
    policy: { action: 'opencall.publish' },
    emailVerified: false,
    params: matchParamsSchema,
    query: noQuery,
    body: publishOpenCallRequestSchema,
    response: { status: 201, description: 'Open call published', schema: openCallSchema },
    errors: [
      'not_found',
      'forbidden',
      'entitlement_required',
      'match_not_open',
      'open_call_exists',
      'invalid_missing_count',
      'invalid_call_expiry',
    ],
    rateLimit: 'C',
  }),
  closeOpenCall: defineEndpoint({
    id: 'closeOpenCall',
    summary: "Close the match's open call (captain, co-captain)",
    description:
      'Remaining pending applications are rejected in the same transaction and the applicants ' +
      'notified. No open call → 404.',
    tag: 'open-calls',
    phase: 2,
    method: 'PATCH',
    path: '/api/v1/matches/[id]/open-call',
    client: 'required',
    auth: 'required',
    policy: { action: 'opencall.close' },
    emailVerified: false,
    params: matchParamsSchema,
    query: noQuery,
    body: closeOpenCallRequestSchema,
    response: { status: 200, description: 'Closed open call', schema: openCallSchema },
    errors: ['not_found', 'forbidden'],
    rateLimit: 'G',
  }),
  createApplication: defineEndpoint({
    id: 'createApplication',
    summary: 'Apply to an open call',
    tag: 'open-calls',
    phase: 2,
    method: 'POST',
    path: '/api/v1/open-calls/[id]/applications',
    client: 'required',
    auth: 'required',
    policy: { action: 'application.create' },
    emailVerified: true,
    params: openCallParamsSchema,
    query: noQuery,
    body: createApplicationRequestSchema,
    response: { status: 201, description: 'Application created', schema: applicationSchema },
    errors: [
      'not_found',
      'already_participant',
      'call_closed',
      'match_not_open',
      'already_applied',
    ],
    rateLimit: 'O',
  }),
  listApplications: defineEndpoint({
    id: 'listApplications',
    summary: 'Applications to an open call (staff: all; applicant: own row)',
    description:
      'Sorted by creation time ascending (keyset cursor). Items carry the public applicant ' +
      'profile only, never email or district (ADR-0041).',
    tag: 'open-calls',
    phase: 2,
    method: 'GET',
    path: '/api/v1/open-calls/[id]/applications',
    client: 'required',
    auth: 'required',
    policy: { action: 'application.list' },
    emailVerified: false,
    params: openCallParamsSchema,
    query: listApplicationsQuerySchema,
    body: null,
    response: {
      status: 200,
      description: 'Page of applications',
      schema: paginatedResponseSchema(applicationSchema),
    },
    errors: ['not_found', 'invalid_cursor'],
    rateLimit: null,
  }),
  decideApplication: defineEndpoint({
    id: 'decideApplication',
    summary: 'Accept or reject (staff) or withdraw (applicant) an application',
    tag: 'open-calls',
    phase: 2,
    method: 'PATCH',
    path: '/api/v1/open-calls/[id]/applications/[appId]',
    client: 'required',
    auth: 'required',
    policy: {
      selectBy: 'body.status',
      actions: {
        accepted: 'application.decide',
        rejected: 'application.decide',
        withdrawn: 'application.withdraw',
      },
    },
    emailVerified: false,
    params: applicationParamsSchema,
    query: noQuery,
    body: decideApplicationRequestSchema,
    response: { status: 200, description: 'Updated application', schema: applicationSchema },
    errors: [
      'not_found',
      'forbidden',
      'application_not_pending',
      'call_closed',
      'match_not_open',
      'already_participant',
      'match_full',
    ],
    rateLimit: 'G',
  }),

  // -------------------------------------------------------------------------
  // Venues and reviews
  // -------------------------------------------------------------------------
  listVenues: defineEndpoint({
    id: 'listVenues',
    summary: 'Venue directory, filterable by district and text',
    description: 'Verified and sample venues for everyone; unverified ones only for their creator.',
    tag: 'venues',
    phase: 2,
    method: 'GET',
    path: '/api/v1/venues',
    client: 'required',
    auth: 'optional',
    policy: { action: 'venue.list' },
    emailVerified: false,
    params: noParams,
    query: listVenuesQuerySchema,
    body: null,
    response: {
      status: 200,
      description: 'Page of venues',
      schema: paginatedResponseSchema(venueSummarySchema),
    },
    errors: ['invalid_cursor'],
    rateLimit: null,
  }),
  getVenue: defineEndpoint({
    id: 'getVenue',
    summary: 'Venue detail by slug',
    description: 'An unverified venue answers 404 to everyone except its creator.',
    tag: 'venues',
    phase: 2,
    method: 'GET',
    path: '/api/v1/venues/[slug]',
    client: 'required',
    auth: 'optional',
    policy: { action: 'venue.read' },
    emailVerified: false,
    params: venueParamsSchema,
    query: noQuery,
    body: null,
    response: { status: 200, description: 'Venue', schema: venueDetailSchema },
    errors: ['not_found'],
    rateLimit: null,
  }),
  createVenue: defineEndpoint({
    id: 'createVenue',
    summary: 'Suggest a venue (created unverified)',
    description:
      'A venue with the same normalised name in the same district answers 409 `venue_exists`; ' +
      'the problem body then carries `existingSlug` when that venue is readable by the caller ' +
      '(ADR-0038).',
    tag: 'venues',
    phase: 2,
    method: 'POST',
    path: '/api/v1/venues',
    client: 'required',
    auth: 'required',
    policy: { action: 'venue.create' },
    emailVerified: true,
    params: noParams,
    query: noQuery,
    body: createVenueRequestSchema,
    response: { status: 201, description: 'Venue created', schema: venueDetailSchema },
    errors: ['venue_exists'],
    rateLimit: 'V',
  }),
  createReview: defineEndpoint({
    id: 'createReview',
    summary: 'Review a venue after playing there (one per user)',
    description:
      'Requires an `in` RSVP on a played match at this venue (ADR-0038). Addressed by slug: ' +
      'Next.js requires one dynamic segment name per level, shared with `GET venues/[slug]`.',
    tag: 'venues',
    phase: 2,
    method: 'POST',
    path: '/api/v1/venues/[slug]/reviews',
    client: 'required',
    auth: 'required',
    policy: { action: 'review.create' },
    emailVerified: true,
    params: venueParamsSchema,
    query: noQuery,
    body: createReviewRequestSchema,
    response: { status: 201, description: 'Review created', schema: venueReviewSchema },
    errors: ['not_found', 'review_not_eligible', 'already_reviewed'],
    rateLimit: 'W',
  }),
  deleteOwnReview: defineEndpoint({
    id: 'deleteOwnReview',
    summary: "Delete the caller's own review of a venue",
    tag: 'venues',
    phase: 2,
    method: 'DELETE',
    path: '/api/v1/venues/[slug]/reviews/mine',
    client: 'required',
    auth: 'required',
    policy: { action: 'review.deleteOwn' },
    emailVerified: false,
    params: venueParamsSchema,
    query: noQuery,
    body: null,
    response: { status: 204, description: 'Review deleted', schema: null },
    errors: ['not_found'],
    rateLimit: 'G',
  }),

  // -------------------------------------------------------------------------
  // Uploads
  // -------------------------------------------------------------------------
  presignUpload: defineEndpoint({
    id: 'presignUpload',
    summary: 'Presign an avatar or team badge upload',
    description:
      'Avatar: any authenticated user. Badge: staff of `teamId` (non-members 404, players 403).',
    tag: 'uploads',
    phase: 2,
    method: 'POST',
    path: '/api/v1/uploads/presign',
    client: 'required',
    auth: 'required',
    policy: {
      selectBy: 'body.kind',
      actions: { avatar: 'upload.presign.avatar', badge: 'upload.presign.badge' },
    },
    emailVerified: false,
    params: noParams,
    query: noQuery,
    body: presignUploadRequestSchema,
    response: { status: 201, description: 'Presigned PUT', schema: presignUploadResponseSchema },
    errors: ['not_found', 'forbidden'],
    rateLimit: 'U',
  }),
  completeUpload: defineEndpoint({
    id: 'completeUpload',
    summary: 'Hand an uploaded image to the worker for processing (uploader only)',
    description: 'Only from `pending`, within one hour of presigning (ADR-0030).',
    tag: 'uploads',
    phase: 2,
    method: 'POST',
    path: '/api/v1/uploads/[id]/complete',
    client: 'required',
    auth: 'required',
    policy: { action: 'upload.complete' },
    emailVerified: false,
    params: uploadParamsSchema,
    query: noQuery,
    body: completeUploadRequestSchema,
    response: { status: 202, description: 'Processing', schema: completeUploadResponseSchema },
    errors: ['not_found', 'upload_not_pending'],
    rateLimit: 'G',
  }),
  getUpload: defineEndpoint({
    id: 'getUpload',
    summary: 'Status of an upload (uploader only)',
    tag: 'uploads',
    phase: 2,
    method: 'GET',
    path: '/api/v1/uploads/[id]',
    client: 'required',
    auth: 'required',
    policy: { action: 'upload.read' },
    emailVerified: false,
    params: uploadParamsSchema,
    query: noQuery,
    body: null,
    response: { status: 200, description: 'Upload status', schema: uploadStatusResponseSchema },
    errors: ['not_found'],
    rateLimit: null,
  }),

  // -------------------------------------------------------------------------
  // Webhooks (Phase 5, ADR-0063)
  // -------------------------------------------------------------------------
  receiveRevenueCatWebhook: defineEndpoint({
    id: 'receiveRevenueCatWebhook',
    summary: 'RevenueCat subscription event delivery',
    description:
      'No user principal: cookies and bearer tokens are ignored. The `Authorization` header must ' +
      'equal `REVENUECAT_WEBHOOK_SECRET` (constant-time comparison over the raw request), else ' +
      '401 `unauthenticated`; an unset secret answers 503. The event id is stored in ' +
      '`webhook_events` (replay-safe) and the answer is always 200 with the outcome: `accepted` ' +
      '(processing job enqueued), `duplicate` (already stored) or `ignored` (unknown or anonymous ' +
      '`app_user_id`, test or unknown event type, foreign product). Not CORS-enabled, no ' +
      'per-group rate limit (deliveries arrive in bursts and must not be dropped).',
    tag: 'webhooks',
    phase: 5,
    method: 'POST',
    path: '/api/v1/webhooks/revenuecat',
    client: 'exempt',
    auth: 'none',
    policy: { action: 'webhook.revenuecat' },
    emailVerified: false,
    params: noParams,
    query: noQuery,
    body: revenueCatWebhookBodySchema,
    response: {
      status: 200,
      description: 'Delivery outcome',
      schema: revenueCatWebhookResponseSchema,
    },
    errors: ['unauthenticated'],
    rateLimit: null,
  }),

  // -------------------------------------------------------------------------
  // Admin (Phase 5, authorization matrix §3.8, ADR-0064)
  // -------------------------------------------------------------------------
  adminStepUp: defineEndpoint({
    id: 'adminStepUp',
    summary: 'Verify a TOTP code and open the 15-minute step-up window (staff)',
    description:
      '±1 time step, a step cannot be reused, at most 5 attempts per 15 minutes. The window is ' +
      'bound to the current web session or mobile refresh-token family. Audited on success and ' +
      'failure.',
    tag: 'admin',
    phase: 5,
    method: 'POST',
    path: '/api/v1/admin/step-up',
    client: 'required',
    auth: 'required',
    policy: { action: 'admin.stepUp' },
    emailVerified: false,
    params: noParams,
    query: noQuery,
    body: adminStepUpRequestSchema,
    response: { status: 200, description: 'Step-up active', schema: adminStepUpResponseSchema },
    errors: ['forbidden', 'totp_not_enrolled', 'totp_invalid'],
    rateLimit: 'T',
  }),
  adminTotpEnroll: defineEndpoint({
    id: 'adminTotpEnroll',
    summary: 'Start TOTP enrollment with a re-authentication proof (staff without a secret)',
    description:
      'Returns the new secret once; it stays pending until `POST admin/totp/confirm`. A staff ' +
      'account with an active secret answers 409 `totp_already_enrolled`. Audited.',
    tag: 'admin',
    phase: 5,
    method: 'POST',
    path: '/api/v1/admin/totp/enroll',
    client: 'required',
    auth: 'required',
    policy: { action: 'admin.totpEnroll' },
    emailVerified: false,
    params: noParams,
    query: noQuery,
    body: adminTotpEnrollRequestSchema,
    response: {
      status: 201,
      description: 'Pending secret',
      schema: adminTotpEnrollResponseSchema,
    },
    errors: ['forbidden', 'reauth_required', 'totp_already_enrolled'],
    rateLimit: 'T',
  }),
  adminTotpConfirm: defineEndpoint({
    id: 'adminTotpConfirm',
    summary: 'Activate the pending TOTP secret with a code from it (staff)',
    description:
      'No pending secret or an expired enrollment answers 409 `totp_not_enrolled`; a wrong code ' +
      '401 `totp_invalid`. Activation does not open a step-up window. Audited.',
    tag: 'admin',
    phase: 5,
    method: 'POST',
    path: '/api/v1/admin/totp/confirm',
    client: 'required',
    auth: 'required',
    policy: { action: 'admin.totpEnroll' },
    emailVerified: false,
    params: noParams,
    query: noQuery,
    body: adminTotpConfirmRequestSchema,
    response: { status: 204, description: 'TOTP active', schema: null },
    errors: ['forbidden', 'totp_not_enrolled', 'totp_invalid', 'totp_already_enrolled'],
    rateLimit: 'T',
  }),
  listAdminVenues: defineEndpoint({
    id: 'listAdminVenues',
    summary: 'Venues for verification and correction (staff + step-up)',
    tag: 'admin',
    phase: 5,
    method: 'GET',
    path: '/api/v1/admin/venues',
    client: 'required',
    auth: 'required',
    policy: { action: 'admin.read' },
    emailVerified: false,
    stepUp: true,
    params: noParams,
    query: listAdminVenuesQuerySchema,
    body: null,
    response: {
      status: 200,
      description: 'Page of venues',
      schema: paginatedResponseSchema(adminVenueSchema),
    },
    errors: ['forbidden', 'invalid_cursor'],
    rateLimit: null,
  }),
  updateAdminVenue: defineEndpoint({
    id: 'updateAdminVenue',
    summary: 'Verify or correct a venue (staff + step-up; audited)',
    tag: 'admin',
    phase: 5,
    method: 'PATCH',
    path: '/api/v1/admin/venues/[id]',
    client: 'required',
    auth: 'required',
    policy: { action: 'venue.verify' },
    emailVerified: false,
    stepUp: true,
    params: adminIdParamsSchema,
    query: noQuery,
    body: updateAdminVenueRequestSchema,
    response: { status: 200, description: 'Updated venue', schema: adminVenueSchema },
    errors: ['forbidden', 'not_found', 'venue_exists'],
    rateLimit: 'G',
  }),
  importVenues: defineEndpoint({
    id: 'importVenues',
    summary: 'Import venues from CSV (admin + step-up; audited)',
    description:
      'Stores the CSV and enqueues `venue.import`; poll `GET admin/venues/import/{importId}`. ' +
      'Moderators answer 403.',
    tag: 'admin',
    phase: 5,
    method: 'POST',
    path: '/api/v1/admin/venues/import',
    client: 'required',
    auth: 'required',
    policy: { action: 'venue.import' },
    emailVerified: false,
    stepUp: true,
    params: noParams,
    query: noQuery,
    body: venueImportRequestSchema,
    response: { status: 202, description: 'Import queued', schema: venueImportSchema },
    errors: ['forbidden'],
    rateLimit: 'G',
  }),
  getVenueImport: defineEndpoint({
    id: 'getVenueImport',
    summary: 'State of a venue import (staff + step-up)',
    tag: 'admin',
    phase: 5,
    method: 'GET',
    path: '/api/v1/admin/venues/import/[importId]',
    client: 'required',
    auth: 'required',
    policy: { action: 'admin.read' },
    emailVerified: false,
    stepUp: true,
    params: venueImportParamsSchema,
    query: noQuery,
    body: null,
    response: { status: 200, description: 'Import state', schema: venueImportSchema },
    errors: ['forbidden', 'not_found'],
    rateLimit: null,
  }),
  listAdminReviews: defineEndpoint({
    id: 'listAdminReviews',
    summary: 'Venue reviews for moderation (staff + step-up)',
    tag: 'admin',
    phase: 5,
    method: 'GET',
    path: '/api/v1/admin/reviews',
    client: 'required',
    auth: 'required',
    policy: { action: 'admin.read' },
    emailVerified: false,
    stepUp: true,
    params: noParams,
    query: listAdminReviewsQuerySchema,
    body: null,
    response: {
      status: 200,
      description: 'Page of reviews',
      schema: paginatedResponseSchema(adminReviewSchema),
    },
    errors: ['forbidden', 'invalid_cursor'],
    rateLimit: null,
  }),
  deleteAdminReview: defineEndpoint({
    id: 'deleteAdminReview',
    summary: 'Remove a venue review (staff + step-up; audited)',
    tag: 'admin',
    phase: 5,
    method: 'DELETE',
    path: '/api/v1/admin/reviews/[id]',
    client: 'required',
    auth: 'required',
    policy: { action: 'review.delete' },
    emailVerified: false,
    stepUp: true,
    params: adminIdParamsSchema,
    query: noQuery,
    body: null,
    response: { status: 204, description: 'Review removed', schema: null },
    errors: ['forbidden', 'not_found'],
    rateLimit: 'G',
  }),
  listAdminOpenCalls: defineEndpoint({
    id: 'listAdminOpenCalls',
    summary: 'Open calls for moderation (staff + step-up)',
    tag: 'admin',
    phase: 5,
    method: 'GET',
    path: '/api/v1/admin/open-calls',
    client: 'required',
    auth: 'required',
    policy: { action: 'admin.read' },
    emailVerified: false,
    stepUp: true,
    params: noParams,
    query: listAdminOpenCallsQuerySchema,
    body: null,
    response: {
      status: 200,
      description: 'Page of open calls',
      schema: paginatedResponseSchema(adminOpenCallSchema),
    },
    errors: ['forbidden', 'invalid_cursor'],
    rateLimit: null,
  }),
  removeAdminOpenCall: defineEndpoint({
    id: 'removeAdminOpenCall',
    summary: 'Close and hide an open call (staff + step-up; audited)',
    description:
      'Sets status `removed` from any status; pending applications are rejected in the same ' +
      'transaction (ADR-0037). Removing an already removed call answers 204 again.',
    tag: 'admin',
    phase: 5,
    method: 'DELETE',
    path: '/api/v1/admin/open-calls/[id]',
    client: 'required',
    auth: 'required',
    policy: { action: 'opencall.remove' },
    emailVerified: false,
    stepUp: true,
    params: adminIdParamsSchema,
    query: noQuery,
    body: null,
    response: { status: 204, description: 'Open call removed', schema: null },
    errors: ['forbidden', 'not_found'],
    rateLimit: 'G',
  }),
  listAdminUsers: defineEndpoint({
    id: 'listAdminUsers',
    summary: 'Accounts with masked email (staff + step-up)',
    tag: 'admin',
    phase: 5,
    method: 'GET',
    path: '/api/v1/admin/users',
    client: 'required',
    auth: 'required',
    policy: { action: 'admin.read' },
    emailVerified: false,
    stepUp: true,
    params: noParams,
    query: listAdminUsersQuerySchema,
    body: null,
    response: {
      status: 200,
      description: 'Page of users',
      schema: paginatedResponseSchema(adminUserSchema),
    },
    errors: ['forbidden', 'invalid_cursor'],
    rateLimit: null,
  }),
  setUserRole: defineEndpoint({
    id: 'setUserRole',
    summary: "Change a user's platform role (admin + step-up + fresh TOTP; audited)",
    tag: 'admin',
    phase: 5,
    method: 'PATCH',
    path: '/api/v1/admin/users/[id]/role',
    client: 'required',
    auth: 'required',
    policy: { action: 'admin.role.manage' },
    emailVerified: false,
    stepUp: true,
    params: adminIdParamsSchema,
    query: noQuery,
    body: setUserRoleRequestSchema,
    response: { status: 200, description: 'Updated user', schema: adminUserSchema },
    errors: ['forbidden', 'not_found', 'totp_invalid', 'last_admin'],
    rateLimit: 'G',
  }),
  setUserDeactivated: defineEndpoint({
    id: 'setUserDeactivated',
    summary: 'Deactivate or reactivate a user (admin + step-up + fresh TOTP; audited)',
    tag: 'admin',
    phase: 5,
    method: 'PATCH',
    path: '/api/v1/admin/users/[id]/deactivate',
    client: 'required',
    auth: 'required',
    policy: { action: 'admin.user.deactivate' },
    emailVerified: false,
    stepUp: true,
    params: adminIdParamsSchema,
    query: noQuery,
    body: setUserDeactivatedRequestSchema,
    response: { status: 200, description: 'Updated user', schema: adminUserSchema },
    errors: ['forbidden', 'not_found', 'totp_invalid', 'last_admin', 'deletion_pending'],
    rateLimit: 'G',
  }),
  listAuditLogs: defineEndpoint({
    id: 'listAuditLogs',
    summary: 'Audit log, newest first (admin + step-up)',
    tag: 'admin',
    phase: 5,
    method: 'GET',
    path: '/api/v1/admin/audit-logs',
    client: 'required',
    auth: 'required',
    policy: { action: 'admin.audit.read' },
    emailVerified: false,
    stepUp: true,
    params: noParams,
    query: listAuditLogsQuerySchema,
    body: null,
    response: {
      status: 200,
      description: 'Page of audit rows',
      schema: paginatedResponseSchema(auditLogEntrySchema),
    },
    errors: ['forbidden', 'invalid_cursor'],
    rateLimit: null,
  }),
} as const satisfies Record<string, EndpointDefinition>;

export type EndpointId = keyof typeof ENDPOINTS;

/** Every registered endpoint in declaration order. */
export const ENDPOINT_LIST: readonly EndpointDefinition[] = Object.values(ENDPOINTS);

/** Policy actions an endpoint can authorize (one, or several selected by a body field). */
export function endpointActions(endpoint: EndpointDefinition): Action[] {
  const { policy } = endpoint;
  if ('selectBy' in policy) {
    return [...new Set(Object.values(policy.actions))];
  }
  return policy.action === null ? [] : [policy.action];
}

/** Names of the dynamic segments of a route pattern, in order (`[id]` → `id`). */
export function pathParamNames(path: string): string[] {
  return [...path.matchAll(/\[([A-Za-z][A-Za-z0-9]*)\]/g)].map((match) => match[1] ?? '');
}

/** Route pattern → OpenAPI path template (`/api/v1/teams/[id]` → `/api/v1/teams/{id}`). */
export function toOpenApiPath(path: string): string {
  return path.replace(/\[([A-Za-z][A-Za-z0-9]*)\]/g, '{$1}');
}

/**
 * Every error code an operation can answer with: the endpoint's own `errors` plus the codes its
 * definition implies (client header and input validation, body limits, authentication, CSRF on
 * web mutations, email verification, admin step-up, rate limiting, and server failures).
 */
export function endpointErrorCodes(endpoint: EndpointDefinition): ErrorCode[] {
  const codes = new Set<ErrorCode>(['validation_failed']);
  if (endpoint.body !== null) {
    codes.add('payload_too_large');
    codes.add('unsupported_media_type');
  }
  if (endpoint.auth !== 'none') {
    codes.add('unauthenticated');
    codes.add('account_deactivated');
  }
  if (endpoint.auth === 'required' && endpoint.method !== 'GET') {
    codes.add('csrf_failed');
  }
  if (endpoint.emailVerified) {
    codes.add('email_unverified');
  }
  if (endpoint.stepUp === true) {
    codes.add('step_up_required');
  }
  for (const code of endpoint.errors) {
    codes.add(code);
  }
  if (endpoint.rateLimit !== null) {
    codes.add('rate_limited');
  }
  codes.add('internal_error');
  codes.add('service_unavailable');
  return [...codes];
}
