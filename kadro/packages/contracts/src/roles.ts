import { z } from 'zod';

/**
 * Roles evaluated by the authorization policy (security checklist item 3).
 * `guest` is an unauthenticated caller; `player`, `co_captain` and `captain` are relationships to a
 * team; `moderator` and `admin` are platform roles whose powers apply only under `/admin/**`.
 */
export const ROLES = ['guest', 'player', 'co_captain', 'captain', 'moderator', 'admin'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/** `users.role`. Every authenticated account is at least `user`. */
export const PLATFORM_ROLES = ['user', 'moderator', 'admin'] as const;
export const platformRoleSchema = z.enum(PLATFORM_ROLES);
export type PlatformRole = z.infer<typeof platformRoleSchema>;

/** `team_members.role`. Exactly one captain per team. */
export const TEAM_ROLES = ['captain', 'co_captain', 'player'] as const;
export const teamRoleSchema = z.enum(TEAM_ROLES);
export type TeamRole = z.infer<typeof teamRoleSchema>;

/**
 * Policy actions passed to `can(actor, action, resource)`. Mirrors the "Policy action" column of
 * docs/security/authorization-matrix.md §3; the `admin.*` family of the checklist is expanded to
 * the concrete admin actions listed there.
 */
export const ACTIONS = [
  'auth.register',
  'auth.login',
  'auth.refresh',
  'auth.logout',
  'auth.verifyEmail',
  'auth.forgot',
  'auth.reset',
  'auth.apple',
  'auth.google',
  'me.read',
  'me.update',
  'me.delete',
  'pushToken.register',
  'team.list',
  'team.create',
  'team.read',
  'team.update',
  'team.delete',
  'invite.create',
  'invite.list',
  'invite.revoke',
  'invite.preview',
  'invite.accept',
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
  'opencall.list',
  'opencall.publish',
  'opencall.close',
  'opencall.remove',
  'application.create',
  'application.list',
  'application.decide',
  'application.withdraw',
  'venue.list',
  'venue.read',
  'venue.create',
  'venue.verify',
  'venue.import',
  'review.create',
  'review.deleteOwn',
  'review.delete',
  'upload.presign.avatar',
  'upload.presign.badge',
  'upload.complete',
  'upload.read',
  'webhook.revenuecat',
  'admin.stepUp',
  'admin.totpEnroll',
  'admin.read',
  'admin.role.manage',
  'admin.user.deactivate',
  'admin.audit.read',
] as const;
export const actionSchema = z.enum(ACTIONS);
export type Action = z.infer<typeof actionSchema>;
