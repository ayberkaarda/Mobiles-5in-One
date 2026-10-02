/**
 * Response and error types from `packages/contracts`, the single source of the API shapes.
 * Type-only: nothing from the contracts package is bundled into the app. The mobile package does
 * not list `@kadro/contracts` as a dependency yet, so the types are read by path; when the
 * dependency is added, only this import changes.
 */
export type {
  AcceptInviteResponse,
  CreateInviteResponse,
  CreateTeamRequest,
  ErrorCode,
  InvitePreview,
  MatchSummary,
  MeResponse,
  MobileAuthResponse,
  MobileRefreshResponse,
  OpenCallPublic,
  Paginated,
  TeamDetail,
  TeamInvite,
  TeamMember,
  TeamRole,
  TeamSummary,
  TokenPair,
  UserPublic,
  VenueSummary,
} from '../../../../packages/contracts/src/index';
