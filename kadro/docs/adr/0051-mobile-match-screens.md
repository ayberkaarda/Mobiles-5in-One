# ADR-0051: Mobile matches: screens, RSVP, lineup, payments and MVP vote

- Status: Proposed
- Date: 2026-10-03
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §3 stories 3–5 and 9, §5 (matches endpoints), §8 (i18n); ADR-0004,
  ADR-0006, ADR-0035, ADR-0036, ADR-0047, ADR-0048, ADR-0050; authorization matrix §3.4, §4.3,
  §4.4, §6

## Context

The Maçlar tab of the mobile foundation (ADR-0047) lists upcoming matches but nothing opens. Players
need to answer a match (`in | out | maybe`, with the server's waitlist), see the lineup and their
share; captains and co-captains need to create and edit matches, change their status, set the
lineup, mark payments and cancel; everyone confirmed votes for the MVP after the match. The API
for all of this exists (`packages/contracts` endpoints `listMatches` .. `voteMvp`). Three facts
shape the client:

- the match response carries no team role, and a match guest (an open-call player) gets a narrower
  projection without fee total, payment flags or the team's other matches (footnote 11);
- money, lineup and the MVP vote are decisions the server validates (ADR-0004, ADR-0035,
  ADR-0036); the app must not offer controls the server will refuse;
- on the pitch the signal is weak; the last known match must stay readable (ADR-0047).

## Decision

### Routes

- Match screens sit under their team: `takim/[id]/mac` (all matches of a team, paginated, with
  "create" for staff), `takim/[id]/mac/yeni`, `takim/[id]/mac/[matchId]` (detail),
  `.../duzenle` (edit), `.../dizilis` (lineup) and `.../odemeler` (payments). They are in the root
  stack inside the signed-in guard, like the team screens (ADR-0050).
- `mac/[code]` stays the team invite link (ADR-0034, ADR-0045); match routes never use the bare
  `mac/` prefix. A guest opens a match by its id; the team segment of the route is only used to
  build links, the screens read the team from the match.
- The Maçlar tab shows upcoming matches of every team plus played matches whose MVP vote is open,
  and one button per team for its full list.

### Roles in the UI

- The viewer's role comes from `GET teams/:id` (`myRole`), read only for the member projection; a
  guest has no role and no staff control. Staff controls appear only once the role has loaded; when
  the team cannot be loaded (offline without a saved copy, server error), the screens show an error
  with retry in their place instead of hiding them or saying the action is not allowed.
- "Back" from a guest's match leads to the Maçlar tab, because the team's match list answers 404
  for a guest.
- Controls follow matrix §3.4: staff of a team that is not read-only create matches; staff edit
  `draft`, `open` and `locked` matches; fee, slots and format are disabled from the first lock on
  and never sent unless changed (ADR-0004); status buttons offer exactly the footnote 12
  transitions, `played` only after the start and only after a confirmation; `DELETE` deletes a
  draft and cancels an open or locked match, after a confirmation; staff set the lineup in `open`
  and `locked`; staff mark confirmed players paid in `locked` and `played`, a co-captain never
  their own row; a confirmed player votes once, for someone else, while the window is open.
- RSVP choices follow footnote 14: all three while `open` and not started, only `out` in `locked`,
  none otherwise. A choice that changes nothing (`in` while confirmed or waitlisted) is not sent.

### Data and writes

- All calls go through the shared API client and a matches API module over the contract paths;
  ids are URL-encoded; the RSVP and vote user is always the session's.
- Query keys: the match lives under the persisted `matches` root (`matches/detail/<id>`), the team
  list under `matches/team/<teamId>/all`, below the key the teams area removes after leaving a team.
  The saved match is shown with the "showing saved data" notice when a refresh fails.
- Only the RSVP is optimistic. The predicted status (`waitlist` when a member's `in` exceeds the
  slots) is shown at once. A guest's `in` is the exception and waits for the server: the guest
  projection has no slots or counts, and a full match answers a guest with 409 `match_full`, never
  with the waitlist (footnote 14). For the optimistic case, the server's answer replaces the
  prediction; a refusal puts the previous match object back exactly, unless a refetch has replaced
  the optimistic one meanwhile.
- Everything else is pessimistic: create, edit, status, cancel, lineup, payment marks and the vote
  wait for the server; the answer is written into the cached match, then the match and the team
  lists are refetched in the background (never awaited, ADR-0050).
- Writes of one match share a mutation key; the match controls are disabled while one runs, so an
  optimistic RSVP never overlaps another write.

### Forms, money, lineup

- Day and time are typed as `GG.AA.YYYY` and `SS:DD` in the device time zone (no date picker
  module is a dependency); a day that does not exist or a start in the past is refused on the
  device. The fee is typed in lira (`1.500`, `1500,50`) and sent as kuruş; the checks mirror
  `LIMITS` and `createMatchRequestSchema`, compared by tests. A directory venue is found through
  `GET venues?q=`; otherwise free text.
- Shares: the contract gives the base share (`sharePerPlayerMinor`, `floor(fee / n)`) and the
  viewer's exact share (`myShareMinor`), but no share per participant and no documented order of
  `participants`. So every other row shows the base share, the viewer's row the exact share, and
  when the fee does not split evenly the screen says that some shares are 1 kuruş higher and labels
  the collected sum as a lower bound. Nothing depends on the order of `participants`; a per-row
  share would need a contract change.
- Lineup by tapping: each confirmed player gets A, B or bench; a full side (`ceil(slots / 2)`) is
  disabled; "auto-balance" applies a copy of the contracts' `suggestLineup` (a test runs both on the
  same inputs, since the contracts package is not bundled); nothing is sent before "save", which
  replaces the whole lineup. Players see the sides read-only.
- The waitlist position is not shown: the queue is ordered by the server-only `waitlisted_at`,
  which the contract does not expose.

### Copy, accessibility

- New `matches` namespace (tr first, en). Failures use the error catalog (ADR-0048).
- Choices are radio buttons of at least 44 pt with a spoken name per option ("Zeynep: A takımı");
  facts are read as one element ("Toplam ücret: ₺1.500"); confirmations are announced as alerts.

## Consequences

- The match flows of stories 3–5 and 9 work on the phone; a control appears only where the server
  would allow it, and the server's refusal is shown with the catalog copy and the request id.
- An RSVP feels instant on a slow connection; a refused one returns to the exact previous state.
- Known limits: no drag and drop for the lineup, no lineup history (Pro, Phase 5), no team-screen
  link to the match list (the team screen belongs to the teams area; the tab and deep routes reach
  it). Open-call publishing from the match detail is added by ADR-0052.

## Rejected alternatives

- **Optimistic payment marks and lineup.** Both are audited or validated decisions; showing them
  before the server agrees would let staff believe a refused mark or side was stored.
- **Match routes under `mac/`.** `mac/<code>` is the invite link of the universal-link paths; a
  second meaning would make every match link ambiguous.
- **Reading the role from the team list.** The list is paginated; the team detail is exact for the
  one team the match belongs to.
