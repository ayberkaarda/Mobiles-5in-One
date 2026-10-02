# Handoff contracts → security 001

- From: `packages/contracts` (Phase 2 domain contracts)
- To: owner of `docs/security`
- Status: resolved (1: review rows use `venues/:slug/...`, ADR-0038; 2: `invite.create` is **V** in the matrix, ADR-0034 wins; 3: matrix §8 group I covers `GET invites/:code`; 4: no cancel endpoint, noted on the `DELETE me` row; 5: `GET open-calls/:id/applications` with action `application.list`, ADR-0041, matrix §3.5 footnote 33)

The endpoint registry (`packages/contracts/src/endpoints.ts`) is tested against the endpoint
tables of the authorization matrix: every Phase 1 / Phase 2 row maps to one registry operation with
the same method, path and action, and back. Points for the matrix:

1. **Venue review paths.** Matrix rows read `POST venues/:id/reviews` and
   `DELETE venues/:id/reviews/mine`; the registry uses `venues/[slug]/...` because Next.js allows
   one dynamic segment name per path level, shared with `GET venues/[slug]`. Slugs are unique and
   server-generated. Proposal: write the rows as `venues/:slug/reviews`.
2. **`invite.create` and email verification.** ADR-0034 requires a verified email to create an
   invite; matrix §3.3 shows plain `Y` for co / cap. The registry follows the matrix
   (`emailVerified: false`). One of the two needs aligning.
3. **Reads with a rate limit.** `GET invites/:code` is the only read with a group (I); the
   registry carries it, matrix §8 already lists it.
4. **Deletion cancel.** No endpoint exists or is needed: sign-in during the grace period cancels
   (ADR-0012). The registry documents this on the sign-in and `DELETE me` operations.
5. **Staff application list.** §5 has no `GET open-calls/:id/applications`; staff learn about
   applications only through the `application.received` push and its `applicationId`. A list for
   the call's staff (ADR-0039 already names "applications" among the paginated lists) would need a
   matrix row and a policy action before contracts adds it.
