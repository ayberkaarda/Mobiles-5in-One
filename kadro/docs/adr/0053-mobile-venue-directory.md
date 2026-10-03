# ADR-0053: Mobile venue directory (Saha Rehberi): list, detail, reviews and suggestions

- Status: Accepted
- Date: 2026-10-03
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §0 rule 6, §3 story 7, §5 (venue endpoints), §6 item 16, §8 (i18n);
  ADR-0038, ADR-0039, ADR-0045, ADR-0047, ADR-0048, ADR-0050, ADR-0051, ADR-0052; authorization
  matrix §3.6 footnotes 23, 24, 32, §4.5, §5, §6

## Context

The Sahalar tab of the mobile foundation (ADR-0047) listed venues without search, and nothing
opened. Story 7 needs the directory on the phone: find a pitch by name and district, read its
facts and reviews, review it after playing there, suggest a missing pitch, and start a match at
it. The API exists (`listVenues`, `getVenue`, `createVenue`, `createReview`, `deleteOwnReview`).
Facts of that API that shape the client:

- `GET venues/:slug` returns the facts, the newest page of reviews (`recentReviews`, other users'
  free text) and the caller's own review (`myReview`) in one answer; there is no review list
  endpoint and no review edit endpoint (matrix §4.5, ADR-0038);
- review eligibility (an `in` RSVP on a played match at the venue) is decided by the server only;
- a suggested venue is unverified and readable only by its creator; its phone and address are
  public only after verification (footnote 23);
- `POST venues` requires a location (latitude, longitude) and the app has no map picker.

## Decision

### Routes

- The tab `(tabs)/sahalar` lists venues. A venue opens at `saha/[slug]`, the venue path of the
  app-link set (ADR-0045); the add form is `saha/yeni`. Server slugs are always
  `<name>-<district>` (at least one dash), so no venue slug is `yeni`. Both routes are in the root
  stack inside the signed-in guard. A slug that is not a server slug shows "not found" without a
  request.

### List

- Search by name (`q`, sent trimmed, 2..60 characters: the match form's venue search rule, one
  function for both) and district (the district picker of the open-call area, imported, not
  copied). Only a district id is sent, never the device location.
- A row shows the name, the sample label for `isSample` rows (`[ÖRNEK] Gerçek saha değil`, on top
  of the `[ÖRNEK]` name prefix of the seed), "not verified" for the viewer's own suggestions,
  district, indoor or outdoor, and the price range in lira from kuruş.
- Rating rule (ADR-0038): an average is shown only from 3 reviews on; below that the row says how
  many reviews exist and that a rating needs 3. The threshold is one constant
  (`RATING_MIN_REVIEWS`) used by every screen and interpolated into the copy.
- Map view: not built, list only. `react-native-maps` was a dependency until it was removed as unused; no
  Google Maps API key or config plugin was ever set up (same as ADR-0052), and a map cannot
  be tested without a device. No new dependency was added.

### Detail

- Facts: district, indoor or outdoor, hourly price range, rating, address, features split into
  present, absent and unknown (an absent key is unknown), and the phone as a `tel:` link. The link
  is built only from a plain number (digits, spaces, leading `+`); anything else is shown as text.
- Labels: verified badge; sample label plus a notice that the entry is not a real pitch; for an
  unverified venue (the viewer is its creator) a notice that only they see it until verification.
- Reviews are rendered as plain text, never markdown or links (footnote 24, §6 item 16). The
  other reviews are sorted newest first on the device (the contract does not promise an order) and
  the viewer's own review is shown on its own, not a second time in the list. When the venue has
  more reviews than the page carries, the screen says so.
- "Bu sahada maç kur": the viewer's teams in which they are captain or co-captain and that are
  not read-only (footnote 10, same function as the match screens). One such team opens its
  create-match screen directly, several ask which one, none explains why. A failed team load
  shows a retry, never "you are not staff". The create-match screen receives only `?venue=<id>`
  and takes the venue name from the app's cached venue data (detail facts or a list); an id the
  app has not read leaves the form as it was, so a link cannot put an arbitrary name on it. This
  is a small change in `app/takim/[id]/mac/yeni.tsx`: one import, one hook call reading the
  `venue` parameter, and the form's `initial` values.

### Reviews

- With a verified email (`POST reviews` is a **V** action) and no own review, the form is offered:
  rating 1..5 and an optional plain text up to 500 characters, checked like
  `createReviewRequestSchema` (tests compare). A line above the form states the eligibility rule;
  a 403 `review_not_eligible` shows that rule as the error, and the typed text stays.
- The own review can be deleted (confirmation first; no **V** needed, footnote 32) and, with a
  verified email, rewritten. There is no edit endpoint, so a rewrite is a delete followed by a
  create, run as one write and announced before sending. If the delete succeeds and the create
  is refused (daily limit W, network), the app says that the old review is gone and keeps the new
  text in the form to send again.
- If the account cannot be loaded, the review section shows a retry, not "verify your email".

### Suggesting a venue

- Shown only with a verified email; otherwise a notice. The screen says before the form that the
  venue is created unverified, visible only to the creator until a moderator verifies it, and that
  phone and address become public only after verification.
- Fields: name (2..120), district (picker), location as "latitude, longitude" in decimal degrees
  (pasted from a map app), optional address (≤ 200) and phone (7..20 digits / spaces / leading
  `+`), indoor or outdoor, the four features as yes / no / don't know (don't know sends nothing),
  and optional hourly prices in lira (the match form's lira parser), lowest ≤ highest. Every rule
  mirrors `createVenueRequestSchema`; tests compare. One request per press series.
- 409 `venue_exists` says a venue of that name exists in the district and suggests searching for
  it; 429 says the daily limit is reached (no number is hard-coded in the copy).

### Data and writes

- Persisted query keys (`venues` root): `list/<filters>` (public projection) and `facts/<slug>`,
  the detail without `recentReviews` and `myReview`, written field by field on every successful
  detail read. Offline, the facts are shown with the "showing saved data" notice and the reviews
  section says they need a connection, with a retry.
- Memory-only key (`venue-private` root, not in the persisted allow-list): `detail/<slug>`, the full
  answer with other users' review texts and the viewer's own review. It is never written to the
  device, like the open-call applications (ADR-0052). Sign-out clears every key (ADR-0047).
- A 404 on the detail is final "not found" without retry and removes the kept facts, so a venue
  that was removed or is no longer readable does not reappear offline.
- Nothing is optimistic. Review writes on one venue share a mutation key and disable the controls
  while one runs; the answer is written into the detail, the detail and the lists refetch in the
  background (never awaited), since the rating is computed by the server. 409 `already_reviewed`
  re-reads the detail (the own review then appears). A delete answered 404 ends in the same state
  as a success. A created venue is written into the cache and the screen opens it.

### Copy, accessibility

- New `venues` namespace (tr first, en). Venue-specific failures (`review_not_eligible`,
  `already_reviewed`, `venue_exists`, `email_unverified`, the daily limits) use this namespace;
  everything else uses the error catalog (ADR-0048), with the request id shown.
- The rating choices are radio buttons of at least 44 pt with a spoken "4 out of 5"; the phone is
  a link with the number in its spoken label.

## Consequences

- Story 7 works on the phone end to end against the existing API: search, read, review, rewrite,
  delete, suggest, and start a match at a venue.
- Known limits, recorded as contract handoffs rather than worked around: only the newest page of
  reviews is readable (no review list endpoint); a rewrite costs a delete and a create and can lose
  the old review when the create is refused (no edit endpoint); `existingSlug` of a 409
  `venue_exists` cannot be read because the app's problem parser keeps machine fields only, so the
  app cannot link to the existing venue; the rating threshold of 3 exists only in ADR-0038 and
  this app, not as a shared contract constant; the location is typed as coordinates (no map
  picker); "Bu sahada maç kur" reads the first page of the viewer's teams.

## Rejected alternatives

- **Persisting the full detail.** It holds other users' free text; the threat is the same as the
  application notes of ADR-0052.
- **Taking the venue name for the match form from the route.** A crafted link could show any name
  next to a real venue id.
- **District centroid as the location of a suggested venue.** It would publish a made-up point as
  the pitch's position (spec §0 rule 6: no fabricated real-world data).
- **Device location for the suggestion form.** Would add a permission prompt and a device-only
  test path; the coordinates field works everywhere and can be replaced by a map picker once maps
  are configured.
