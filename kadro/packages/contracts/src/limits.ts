/**
 * Shared input limits (security checklist item 6). API handlers, database constraints and
 * client-side forms all read these values so that the three layers can never drift apart.
 */
export const LIMITS = {
  /** Maximum accepted JSON request body in bytes (1 MiB). */
  jsonBodyMaxBytes: 1_048_576,
  email: { max: 254 },
  /** Password rule: at least 10 characters; the upper bound caps Argon2id hashing cost. */
  password: { min: 10, max: 128 },
  displayName: { min: 2, max: 40 },
  /** Optional label a client attaches to a refresh token, e.g. "iPhone 15". */
  deviceLabel: { max: 64 },
  /** Total match fee in minor units (kuruş): 0 to 1,000,000.00 TRY. */
  feeTotalMinor: { min: 0, max: 1_000_000_00 },
  /** Players per match. */
  slots: { min: 2, max: 30 },
  reviewText: { max: 500 },
  reviewRating: { min: 1, max: 5 },
  applicationMessage: { max: 280 },
  /** Team invite validity window in seconds (1 hour to 14 days, default 7 days) and use count. */
  inviteExpiresInSeconds: { min: 3_600, max: 1_209_600, default: 604_800 },
  inviteMaxUses: { min: 1, max: 50, default: 20 },
  /** Unexpired, not exhausted invites per team (ADR-0034). */
  activeInvitesPerTeam: 10,
  /** Presigned upload size in bytes (1 byte to 2 MiB) and per-user daily quota. */
  uploadBytes: { min: 1, max: 2_097_152 },
  uploadsPerUserPerDay: 10,
  /** Cursor pagination page size. */
  pageSize: { min: 1, max: 100, default: 20 },
  /** Opaque pagination cursor length. */
  cursor: { max: 512 },
  /** Opaque refresh and email tokens: base64url, at least 256 bits of entropy. */
  opaqueToken: { min: 43, max: 128 },
  /** Provider identity tokens (Apple, Google) are compact JWS strings. */
  identityToken: { max: 8_192 },
  /** Raw nonce bound to a Sign in with Apple / Google request. */
  nonce: { min: 16, max: 128 },
  expoPushToken: { max: 256 },
  /** Team name (`teams.name`, database check 2..60). */
  teamName: { min: 2, max: 60 },
  /** Invite codes: 128 bits of CSPRNG randomness, base64url without padding (ADR-0011). */
  inviteCode: { length: 22 },
  /** Free-text venue of a match (`matches.venue_text`, database check <= 200). */
  venueText: { min: 2, max: 200 },
  /** Missing players of an open call: at least one, at most the largest match minus one. */
  missingCount: { min: 1, max: 29 },
  /** Venue name (`venues.name`, database check 2..120), postal address and phone number. */
  venueName: { min: 2, max: 120 },
  venueAddress: { max: 200 },
  venuePhone: { min: 7, max: 20 },
  /** Free-text venue search (`GET venues?q=`, ADR-0039). */
  searchQuery: { min: 2, max: 60 },
  /** Longest `from`..`to` window of `GET open-calls` (ADR-0039). */
  openCallListRangeDays: 31,
  /** An open call must stay listed at least this long (`expires_at ≥ now() + 15 min`, ADR-0037). */
  openCallMinLifetimeSeconds: 900,
  /** Presigned upload URL lifetime and the window to call `complete` (ADR-0030). */
  uploadUrlTtlSeconds: 300,
  uploadCompleteWindowSeconds: 3_600,
  /** Job payload idempotency keys (ADR-0028). */
  idempotencyKey: { max: 128 },
  /** TOTP codes are six digits (RFC 6238 with the default length). */
  totpCode: { length: 6 },
  /** Self-initiated account deletion grace period (security checklist item 21): 7 days. */
  accountDeletionGraceSeconds: 604_800,
  /** MVP voting stays open for 24 hours after a match is marked played. */
  mvpVoteWindowSeconds: 86_400,
  /** `GET districts` returns at most this many rows (Turkey has 973 districts). */
  districtsList: { max: 1_000 },
  /** RevenueCat webhook fields (ADR-0063). */
  revenueCatEventId: { max: 128 },
  revenueCatAppUserId: { max: 256 },
  /** Upper bound of epoch milliseconds accepted from RevenueCat (year 3000). */
  revenueCatEpochMsMax: 32_503_680_000_000,
  /** Admin step-up window after a successful TOTP verification (security checklist item 18). */
  stepUpWindowSeconds: 900,
  /** A started TOTP enrollment must be confirmed within this window (ADR-0064). */
  totpEnrollmentWindowSeconds: 600,
  /** Venue import CSV (ADR-0064): characters of the inline CSV and data rows per import. */
  venueImportCsv: { maxChars: 900_000, maxRows: 5_000 },
  /** Row-level problems an import reports back; the remainder is only counted. */
  venueImportIssues: { max: 50 },
  /** Free-text search in admin lists. */
  adminSearchQuery: { min: 2, max: 60 },
} as const;
