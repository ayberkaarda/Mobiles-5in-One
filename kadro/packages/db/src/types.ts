import type {
  auditLogs,
  deletionRequests,
  districts,
  emailTokens,
  matches,
  matchRsvps,
  mvpVotes,
  openCallApplications,
  openCalls,
  pushTokens,
  rateLimitBuckets,
  refreshTokens,
  subscriptions,
  teamInvites,
  teamMembers,
  teams,
  uploads,
  venueImports,
  users,
  venueReviews,
  venues,
  webhookEvents,
  jobReceipts,
  pushResends,
} from './schema/index.js';

export type District = typeof districts.$inferSelect;
export type NewDistrict = typeof districts.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
export type EmailToken = typeof emailTokens.$inferSelect;
export type NewEmailToken = typeof emailTokens.$inferInsert;
export type DeletionRequest = typeof deletionRequests.$inferSelect;
export type NewDeletionRequest = typeof deletionRequests.$inferInsert;
export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;
export type TeamInvite = typeof teamInvites.$inferSelect;
export type NewTeamInvite = typeof teamInvites.$inferInsert;
export type Venue = typeof venues.$inferSelect;
export type NewVenue = typeof venues.$inferInsert;
export type VenueReview = typeof venueReviews.$inferSelect;
export type NewVenueReview = typeof venueReviews.$inferInsert;
export type Match = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;
export type MatchRsvp = typeof matchRsvps.$inferSelect;
export type NewMatchRsvp = typeof matchRsvps.$inferInsert;
export type MvpVote = typeof mvpVotes.$inferSelect;
export type NewMvpVote = typeof mvpVotes.$inferInsert;
export type OpenCall = typeof openCalls.$inferSelect;
export type NewOpenCall = typeof openCalls.$inferInsert;
export type OpenCallApplication = typeof openCallApplications.$inferSelect;
export type NewOpenCallApplication = typeof openCallApplications.$inferInsert;
export type PushToken = typeof pushTokens.$inferSelect;
export type NewPushToken = typeof pushTokens.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;
export type RateLimitBucket = typeof rateLimitBuckets.$inferSelect;
export type NewRateLimitBucket = typeof rateLimitBuckets.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type JobReceipt = typeof jobReceipts.$inferSelect;
export type NewJobReceipt = typeof jobReceipts.$inferInsert;
export type Upload = typeof uploads.$inferSelect;
export type NewUpload = typeof uploads.$inferInsert;
export type PushResend = typeof pushResends.$inferSelect;
export type NewPushResend = typeof pushResends.$inferInsert;
export type VenueImport = typeof venueImports.$inferSelect;
export type NewVenueImport = typeof venueImports.$inferInsert;
