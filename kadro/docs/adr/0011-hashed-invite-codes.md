# ADR-0011: Team invite codes stored as hashes

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: authorization matrix §3.3 footnote 7, §4.2; threat model T-TEAM-04, T-TEAM-09

## Context

An invite code is a bearer credential: anyone holding it joins the team. The data model lists a
plaintext `team_invites.code`. A database dump, backup or log line containing codes would let a
reader join any team with a live invite. Refresh and email tokens are already stored as SHA-256
hashes.

## Decision

- Codes are generated server-side with 128 bits from a CSPRNG and encoded base64url (22 chars).
- The column is `team_invites.code_hash` (SHA-256 of the code, unique index). The plaintext code is
  never stored. An unsalted hash is sufficient because the input has 128 bits of entropy.
- The plaintext code is returned once, in the `POST teams/:id/invites` response, together with the
  invite URL and QR payload. Staff who need the link again create a new invite.
- `POST invites/:code/accept`, the invite landing page and the deep-link handler look up by
  `code_hash`. Invalid, expired and exhausted codes return the same 404.
- Request logging masks the code segment of `invites/:code/*` and `/mac/:code` paths.

## Consequences

- A leaked database or backup does not reveal usable invite codes.
- `packages/db` uses `code_hash` instead of `code`; `packages/contracts` never returns the code
  after creation.
- The pino path serializer and Sentry `beforeSend` include the invite-path mask.
