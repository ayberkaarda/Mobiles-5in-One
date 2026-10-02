# ADR-0034: Team invite lifecycle and joining

- Status: Accepted; builds on [ADR-0011](0011-hashed-invite-codes.md)
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §3 story 2, §7 (`/mac/[inviteCode]`); ADR-0005, ADR-0011, ADR-0013;
  authorization matrix §3.3 footnote 7, §4.2; threat model T-TEAM-04, T-TEAM-05, T-TEAM-09,
  T-TEAM-10

## Context

ADR-0011 fixes how invite codes are generated and stored. Phase 2 needs the rest of the
lifecycle: defaults, who may create and revoke invites, what accepting does, and what the invite
landing page may show before the visitor joins.

## Decision

- **Create** (`POST teams/:id/invites`, captain or co-captain, verified email, team not
  `is_pro_locked`): body `{ expiresInSeconds?, maxUses? }`, defaults 7 days and 20 uses, ranges
  1 h..14 d and 1..50 (`LIMITS`). Response 201 `{ inviteId, code, url, expiresAt, maxUses }`; the
  code appears only in this response (ADR-0011). At most 10 unexpired, not exhausted invites per
  team; an 11th → 409 `invite_limit`.
- **List** (`GET teams/:id/invites`, staff): id, `createdAt`, `expiresAt`, `uses`, `maxUses`;
  never a code.
- **Revoke** (`DELETE teams/:id/invites/:inviteId`, staff): sets `expires_at = now()`. A leaked
  link can be stopped without waiting for expiry. Audit `invite.revoked`.
- **Preview** (`GET invites/:code`, anonymous allowed, rate limit group I): team name, badge URL,
  district and member count only; never names of members or the captain. Invalid, expired, revoked
  and exhausted codes return the same 404.
- **Accept** (`POST invites/:code/accept`, verified email, rate limit I): in one transaction,
  conditional increment `uses = uses + 1 WHERE uses < max_uses AND expires_at > now()`; zero rows → 404. Already a member → 409 `already_participant` without consuming a use (checked before the
  increment, under a lock on the team row). Joins as `player`. A former member (ADR-0005) rejoins
  normally. Push `team.member_joined` to the captain (ADR-0031).
- The invite link is `https://kadro.app/mac/<code>`; the path segment is masked in logs and Sentry
  (ADR-0011), and the landing page carries `noindex` and no third-party resources.

## Consequences

- A staff member can always end a leaked invite; the number of live codes per team is bounded.
- The preview endpoint discloses only what the landing page shows; probing is limited by group I
  and the uniform 404.
- Contracts additions: `GET teams/:id/invites`, `DELETE teams/:id/invites/:inviteId`,
  `GET invites/:code`, code `invite_limit` (handoff
  `decisions-to-contracts-001`); matrix §3.3 rows added, and the `invite.create` row carries the
  verified-email requirement (**V**, 403 `email_unverified`).

## Rejected alternatives

- **No revoke endpoint (only expiry).** A link posted in the wrong group chat would stay valid for
  up to 14 days.
- **Return the code again from the list.** Requires storing it reversibly, contradicting ADR-0011.
