import { relations } from 'drizzle-orm';

import { districts } from './districts.js';
import { matches, matchRsvps, mvpVotes, openCallApplications, openCalls } from './matches.js';
import { auditLogs, pushTokens, subscriptions } from './system.js';
import { uploads } from './uploads.js';
import { teamInvites, teamMembers, teams } from './teams.js';
import { deletionRequests, emailTokens, refreshTokens, users } from './users.js';
import { venueReviews, venues } from './venues.js';

export const districtsRelations = relations(districts, ({ many }) => ({
  users: many(users),
  teams: many(teams),
  venues: many(venues),
  openCalls: many(openCalls),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  district: one(districts, { fields: [users.districtId], references: [districts.id] }),
  refreshTokens: many(refreshTokens),
  emailTokens: many(emailTokens),
  deletionRequests: many(deletionRequests),
  memberships: many(teamMembers),
  ownedTeams: many(teams),
  rsvps: many(matchRsvps),
  venueReviews: many(venueReviews),
  applications: many(openCallApplications),
  pushTokens: many(pushTokens),
  subscriptions: many(subscriptions),
  createdVenues: many(venues),
  votesCast: many(mvpVotes, { relationName: 'mvp_voter' }),
  votesReceived: many(mvpVotes, { relationName: 'mvp_votee' }),
  auditLogs: many(auditLogs),
  uploads: many(uploads),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
  rotatedFromToken: one(refreshTokens, {
    fields: [refreshTokens.rotatedFrom],
    references: [refreshTokens.id],
  }),
}));

export const emailTokensRelations = relations(emailTokens, ({ one }) => ({
  user: one(users, { fields: [emailTokens.userId], references: [users.id] }),
}));

export const deletionRequestsRelations = relations(deletionRequests, ({ one }) => ({
  user: one(users, { fields: [deletionRequests.userId], references: [users.id] }),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  district: one(districts, { fields: [teams.districtId], references: [districts.id] }),
  owner: one(users, { fields: [teams.ownerId], references: [users.id] }),
  members: many(teamMembers),
  invites: many(teamInvites),
  matches: many(matches),
  uploads: many(uploads),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, { fields: [teamMembers.teamId], references: [teams.id] }),
  user: one(users, { fields: [teamMembers.userId], references: [users.id] }),
}));

export const teamInvitesRelations = relations(teamInvites, ({ one }) => ({
  team: one(teams, { fields: [teamInvites.teamId], references: [teams.id] }),
}));

export const venuesRelations = relations(venues, ({ one, many }) => ({
  district: one(districts, { fields: [venues.districtId], references: [districts.id] }),
  creator: one(users, { fields: [venues.createdBy], references: [users.id] }),
  reviews: many(venueReviews),
  matches: many(matches),
}));

export const venueReviewsRelations = relations(venueReviews, ({ one }) => ({
  venue: one(venues, { fields: [venueReviews.venueId], references: [venues.id] }),
  user: one(users, { fields: [venueReviews.userId], references: [users.id] }),
}));

export const matchesRelations = relations(matches, ({ one, many }) => ({
  team: one(teams, { fields: [matches.teamId], references: [teams.id] }),
  venue: one(venues, { fields: [matches.venueId], references: [venues.id] }),
  rsvps: many(matchRsvps),
  mvpVotes: many(mvpVotes),
  openCalls: many(openCalls),
}));

export const matchRsvpsRelations = relations(matchRsvps, ({ one }) => ({
  match: one(matches, { fields: [matchRsvps.matchId], references: [matches.id] }),
  user: one(users, { fields: [matchRsvps.userId], references: [users.id] }),
}));

export const mvpVotesRelations = relations(mvpVotes, ({ one }) => ({
  match: one(matches, { fields: [mvpVotes.matchId], references: [matches.id] }),
  voter: one(users, {
    fields: [mvpVotes.voterId],
    references: [users.id],
    relationName: 'mvp_voter',
  }),
  votee: one(users, {
    fields: [mvpVotes.voteeId],
    references: [users.id],
    relationName: 'mvp_votee',
  }),
}));

export const openCallsRelations = relations(openCalls, ({ one, many }) => ({
  match: one(matches, { fields: [openCalls.matchId], references: [matches.id] }),
  district: one(districts, { fields: [openCalls.districtId], references: [districts.id] }),
  applications: many(openCallApplications),
}));

export const openCallApplicationsRelations = relations(openCallApplications, ({ one }) => ({
  openCall: one(openCalls, {
    fields: [openCallApplications.openCallId],
    references: [openCalls.id],
  }),
  user: one(users, { fields: [openCallApplications.userId], references: [users.id] }),
}));

export const pushTokensRelations = relations(pushTokens, ({ one }) => ({
  user: one(users, { fields: [pushTokens.userId], references: [users.id] }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  user: one(users, { fields: [subscriptions.userId], references: [users.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(users, { fields: [auditLogs.actorId], references: [users.id] }),
}));

export const uploadsRelations = relations(uploads, ({ one }) => ({
  user: one(users, { fields: [uploads.userId], references: [users.id] }),
  team: one(teams, { fields: [uploads.teamId], references: [teams.id] }),
}));
