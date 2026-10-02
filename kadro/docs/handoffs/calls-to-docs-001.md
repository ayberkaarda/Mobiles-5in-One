# Handoff calls → docs / contracts 001

- From: open-call, application and venue endpoints (`apps/web`, Phase 2)
- To: owner of `docs/**` (ADRs, authorization matrix) and of `packages/contracts`
- Status: open

Decisions taken in the implementation that the documents do not state yet:

1. **`GET venues/:slug/reviews/mine` is not in the registry.** The task list named it; the registry
   and matrix §3.6 only have `DELETE venues/:slug/reviews/mine`. Not implemented. If the client
   needs "my review", either add the endpoint (contracts + matrix row) or rely on
   `GET venues/:slug` (`recentReviews`, display name only).
2. **Resolved:** `409 venue_exists` now carries the contracts extension member `existingSlug` when
   the caller can read the existing venue (verified, sample or own); otherwise it is omitted. The
   response is built in `lib/server/venues/venues.ts` (`venueExistsResponse`) because `ApiError`
   in `lib/server/errors.ts` has no extension members; the `route()` log line of that response has
   no `problemCode`. Owner of `errors.ts`: an extension-member option on `ApiError` would let this
   go back through `route()`.
3. **`[ÖRNEK]` prefix refused in `POST venues`** (400, `body.name` / issue `reserved`): the marker
   identifies seeded sample rows (`venues_sample_name_prefix`); a client name with it would look
   like sample data. Matrix §4.5 could list it next to `is_sample`.
4. **Expired-but-stored-open call on publish.** When `POST matches/:id/open-call` finds a call with
   `status = 'open'` and `expires_at ≤ now()` (expiry job not yet run), it ends that call as
   `expired` (pending applications rejected and notified) and publishes the new one instead of
   409 `open_call_exists`. ADR-0037 "after a call ends, a new call may be published" covers the
   intent; the matrix footnote 19 wording could mention it.
5. **Call closes when the match is full**, not only when `missing_count` reaches 0 (an accepted
   applicant that fills the last slot ends the call and rejects the rest). Footnote 21 mentions
   only `missing_count = 0`.
6. **`GET open-calls?position=GK` also returns calls with `position = null`** ("any position").
   ADR-0039 lists the filter without saying how `null` matches.
7. **Aggregate rating:** `rating.count` is always returned; `rating.average` is `null` below three
   reviews (ADR-0038 "only with at least 3 reviews"). Contract comment says "`null` without
   reviews".
8. **Audit action names** (no personal data, ids and counts only): `opencall.published`,
   `opencall.closed`, `application.accepted`, `application.rejected`, `application.withdrawn`,
   `venue.created`, `review.deletedOwn`. ADR-0008 style would be snake case; same open point as
   handoff `teams-to-docs-001` §1.
9. **Withdraw by staff of a missing application** answers 403 (staff can read the call but may
   never withdraw, matrix §2 step 5 before step 6), not 404. Everyone else gets 404.
