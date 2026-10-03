# ADR-0065: Server-side Pro entitlement and statistics tiers

- Status: Proposed
- Date: 2026-10-03
- Deciders: Engineering, reported to Ayberk (owner)
- Related: product spec §3 items 9 and 10; authorization matrix §3.3 (footnotes 6 and 8), §7;
  ADR-0013, ADR-0063; `apps/web/lib/server/billing/entitlements.ts`,
  `apps/web/lib/server/authorize.ts`, `apps/web/lib/server/domain/relations.ts`,
  `apps/web/lib/server/auth/stats.ts`

## Context

Until Phase 5 the policy actor carried a constant `isPro: false`, and so did the target of a
captaincy transfer. ADR-0063 fixed where entitlement state lives (`subscriptions`, written by the
webhook job and the nightly reconciliation), the shape of `me.entitlements` and the two tiers of
`GET me/stats`. What remained open: when exactly a row grants Pro, where the value is read on each
request, which row `me.entitlements` describes when a user has several, and what the statistics
mean.

Store-side expiry and the `EXPIRATION` event are not simultaneous. If the event is late or lost,
an `active` row keeps its status until the nightly run corrects it, up to a day later.

## Decision

1. **Rule.** A `subscriptions` row grants Pro at time `now` exactly when its status is `active` or
   `grace_period` **and** `expires_at` is null or later than `now`. A user is Pro when at least one
   of their rows grants it. The expiry check closes the gap above: an `active` row whose expiry
   has passed is not Pro, whatever the stored status says. A null expiry is a grant without an end
   date (a promotional or lifetime grant), as RevenueCat reports it. Rows of both environments
   count, because App Review purchases on production builds arrive as sandbox events.
2. **Actor.** `authenticate()` reads the actor's entitlement as an `exists (…)` over the user's
   rows in the same query that already loads the user row (mobile) or the session row (web), at
   the request's clock. `Principal.isPro` feeds `ActorContext.isPro`; nothing is cached in tokens
   or cookies, so a lapse or a refund takes effect on the next request. The query uses the
   `(user_id, product_id, environment)` unique index.
3. **Captaincy target.** `loadMemberTargetRelation` takes the request clock and computes
   `targetIsPro` with the same predicate inside its single query. A transfer to a user who already
   owns a team is allowed only while that user holds Pro (matrix footnote 8).
4. **One rule, two forms.** The predicate exists as SQL (`proSubscriptionExists`) for the actor
   and the target, and as a function over loaded rows (`resolveEntitlements`) for the profile.
   Database tests cover both forms with the same row states (statuses, past and future expiry,
   null expiry, several rows, rows of other users).
5. **`me.entitlements`.** Sent on `GET me`, `PATCH me` and the `user` of the sign-in responses.
   No row → `NO_ENTITLEMENTS`. Otherwise the deciding row is a granting row before any other, then
   the latest expiry (no end date first), then the most recently written row. The reported status
   is the effective one: a lapsed `active` row reads `expired`, a lapsed `grace_period` row reads
   `billing_issue`, so `pro` stays true exactly for `active` and `grace_period` as the schema
   requires. `expiresAt` and `store` are the deciding row's.
6. **Statistics.** `GET me/stats` answers from one query over the caller's RSVP rows on matches
   with status `played`:
   - `matchesPlayed`: those rows with RSVP `in`;
   - `mvpCount`: of those, matches whose vote window has closed and where the caller's vote count
     is above zero and not below any other votee's (ties count for every winner, ADR-0036);
   - `advanced` (Pro only): `matchesPlayedLast30Days` (`starts_at` within 30 days before now),
     `mvpRate` (`mvpCount / matchesPlayed`), `attendanceRate` (`in` rows among all of the caller's
     rows on played matches), `distinctVenues` (directory venues only) and `distinctTeams`. Rates
     are `null` without a denominator.

   The tier is the principal's entitlement from decision 2, so the request that reads the
   statistics and the request that would be refused a Pro action see the same value.

7. **Contract.** The server sends `entitlements` on every profile response from this change on.
   The contract member becomes required together with the mobile test fixtures that build a
   profile without it, because the mobile typecheck reads the same type. Update (ADR-0079): done;
   the app no longer treats a missing member as free.

## Consequences

- Every authenticated request costs one indexed `exists` subquery more, in the round trip it
  already makes.
- A user whose subscription ended loses Pro at the stored expiry even when no event arrives; a
  renewal that arrives late restores it on the next request after the job writes the row.
- Granting Pro to sandbox rows lets TestFlight and App Review testers use Pro features on
  production; they cannot create real revenue either way. Revisit if sandbox abuse appears.
- Not covered here:
  - **Downgrade locking.** Matrix §7 sets `is_pro_locked` on all but the oldest owned team when
    Pro lapses. The gates on locked teams are enforced already; writing the flag belongs to the
    billing jobs and is not part of this change.
  - **Lineup history** ("latest only" for free users, matrix §7). No lineup history is stored:
    each match keeps its current sides only. The gate needs a product definition first.
