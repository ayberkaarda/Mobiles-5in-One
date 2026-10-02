# Handoff matches → contracts 002

- From: match endpoints (`apps/web/lib/server/matches/**`, Phase 2)
- To: owner of `packages/contracts` (`matches.ts` schemas) and `docs/api/openapi.json`
- Status: resolved: contracts added `myShareMinor` to both views; `loadMatchDetail` fills it
  (`exactShare` in `lib/server/matches/projections.ts`), tested in `tests/matches/review.test.ts`

## The actor's exact share is not in the match views (ADR-0036)

`sharePerPlayerMinor` is the base share `floor(fee_total_minor / confirmed)`. ADR-0036 adds the
remainder (`fee_total_minor mod confirmed`) as 1 kuruş to the first confirmed players by RSVP
creation time (ties by id). Members can compute their exact share from `feeTotalMinor` and the
ordered participant list; a guest cannot, because the guest view (footnote 11) carries neither the
fee total nor the remainder. Example: 100 001 kuruş, 4 confirmed, the guest confirmed first: the
guest owes 25 001, the response says 25 000.

Request: add a read-only field to both views, for example

```ts
/** The actor's exact share in kuruş (ADR-0036 remainder rule); null unless the actor is `in`. */
myShareMinor: z.int().min(0).max(LIMITS.feeTotalMinor.max).nullable(),
```

on `matchMemberViewSchema` and `matchGuestViewSchema`, then regenerate the OpenAPI document. It
reveals nothing new to a guest: no fee total, no other player's share, no `paid` flag.

The web handler is not changed until the field exists (the strict response schemas would reject
it). Once added, `loadMatchDetail` fills it from the participant rows it already reads in RSVP
order: `base + (index < remainder ? 1 : 0)` for the actor's position among the `in` rows.

Acceptance: schema field present; `tests/matches` asserts 25 001 for the first confirmed guest in
the example above and `null` for an actor who is not `in`.
