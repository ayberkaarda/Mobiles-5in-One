# Handoff teams → docs 001

- From: team, invite and member endpoints (`apps/web/lib/server/teams/**`, Phase 2)
- To: owner of `docs/adr` and `docs/security`
- Status: open

## 1. Audit action names

ADR-0008 names the transfer audit row `team.captaincy_transfer`. `recordAudit` accepts only dotted
lower-camel segments, so the implementation writes `team.captaincyTransfer`. Other team audit
actions: `team.deleted`, `invite.created`, `invite.revoked`, `invite.accepted`,
`member.roleChanged`, `member.removed`, `member.left` (metadata holds ids, roles and counts only).
Request: amend ADR-0008 to the implemented name (ADR-0034 `invite.revoked` already matches).

## 2. Team deletion is not specified beyond the matrix cell

`DELETE teams/:id` (captain only) hard-deletes the team; foreign keys cascade to memberships,
invites, matches and their RSVPs, MVP votes, open calls and pending badge uploads. That drops the
`played` history of every member and match guest (the same trade-off ADR-0032 accepts for solo
teams, RR-12). The published badge object in R2 is not removed (no job enqueue yet).
Request: record the decision (keep the hard delete, or refuse deletion while `played` matches
exist / soft-delete), and add the badge cleanup to the worker sweep.

## 3. Rate-limit group I key

Matrix §8 says "user + IP" for group I. Implemented as two counters charged together (user and
client address, like group A's "IP and email"); anonymous previews count by address only.
Request: state this in matrix §8.
