# ADR-0038: Venue creation, visibility and review eligibility

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §0.6, §3 story 7; authorization matrix §3.6 footnotes 23–24, §4.5;
  threat model T-VEN-01..08

## Context

Story 7 lets users rate venues 1–5 with a short review, and lets anyone add a venue that stays
unverified until a moderator verifies it. Without a participation rule, any verified account can
review any pitch, which makes rating manipulation and defamation cheap. Unverified venues created by
one user may also appear in the matches of their team.

## Decision

### Creation and visibility

- `POST venues` (verified email, rate limit V 5 / day) creates `verified = false`,
  `is_sample = false`, `created_by = actor`, slug generated server-side from name and district.
  A venue with the same normalised name in the same district → 409 `venue_exists` with the existing
  slug when that venue is readable by the actor.
- Directory read and search (`GET venues`, `GET venues/:slug`): verified and sample venues for
  everyone; an unverified venue only for its creator (matrix §5).
- A match may reference a venue the actor can read. Participants of that match see the venue name
  and district inside the match projection even when the venue is unverified; phone and address of
  an unverified venue are shown only to its creator.
- Unverified venues are excluded from the sitemap, SEO pages and open-call public projection (which
  then shows the district only).

### Reviews (`POST venues/:slug/reviews`)

- Review paths address the venue by its slug, the same dynamic segment as `GET venues/:slug`
  (Next.js allows one segment name per path level). Slugs are unique and server-generated.

- Eligible only if the actor has RSVP `in` on at least one `played` match whose `venue_id` is this
  venue. Otherwise 403 `review_not_eligible`. Free-text venues do not qualify.
- One review per user per venue (unique, 409 `already_reviewed`), rating 1..5, text ≤ 500, plain
  text on mobile and sanitised on web (item 16), rate limit W 10 / day.
- No edit in the MVP. The author may delete their own review (`DELETE venues/:slug/reviews/mine`),
  which closes the matrix §10 open question; moderators remove others' reviews in Phase 5.
- Aggregate rating is shown, and emitted as JSON-LD, only with at least 3 reviews (§7).

## Consequences

- Every rating is backed by a played match at that venue; review spam needs real matches, real
  teams and real participants.
- New venues start with no reviews until a team plays there, which is acceptable for an MVP that
  seeds sample venues and imports real ones.
- Contracts: `review_not_eligible`, `already_reviewed`, `venue_exists`,
  `DELETE venues/:slug/reviews/mine` (handoff `decisions-to-contracts-001`).

## Rejected alternatives

- **Any verified user may review.** Cheapest path to fake ratings and targeted defamation.
- **Review only after moderator approval.** Moderation load grows with every review; the
  participation rule removes most abuse up front.
