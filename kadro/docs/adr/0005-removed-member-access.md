# ADR-0005: Access of removed or departed team members

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: authorization matrix §1.3 (`guest(M)`), §3.3 footnote 9, §5; threat model T-TEAM-08

## Context

The draft kept a removed member's RSVPs on `locked` and `played` matches. Because `guest(M)` is
"has an RSVP on M and is not a member", those kept rows silently turned the removed user into a
match guest: they kept read access to upcoming locked matches and would still appear in the lineup
of a match they were removed from. Whether this was intended was not stated.

## Decision

Removal by staff and voluntary leave have the same effect, applied in one transaction:

1. The `team_members` row is deleted. Team read, roster, match list and every other team-scoped
   endpoint return 404 to the user from then on.
2. RSVPs of the user on the team's matches in `draft`, `open` or `locked` are deleted. Waitlist
   promotion runs; for a `locked` match the captain is notified that a lineup slot is free.
3. RSVPs on `played` matches are kept unchanged (history, stats, MVP results, fee split record).

The kept `played` rows make the user a `guest(M)` of exactly those matches, so they keep the guest
projection of matches they actually played: date, venue, own RSVP, lineup, shares and MVP voting
inside the 24-hour window. They do not see `paid` flags of others, the roster, or any other match.

Rejoining through a new invite restores member access; past `played` rows are unaffected.

## Consequences

- A removed member can no longer read or attend upcoming matches of the team.
- Own play history and stats stay correct and readable, matching what account deletion keeps in
  anonymised form.
- IDOR tests add a fixture `exPlyA` (removed player with one `played` and one `locked` match):
  `played` match → guest projection, `locked` match → 404, team → 404.

## Amendment: team deletion (2026-10-02)

The kept `played` RSVPs of a removed member live as long as the team. A team with a `played` match
and other members cannot be deleted (409 `team_has_history`, matrix §3.3 footnote 34), but once the
captain is its only member it can be, and the former members' `played` rows and guest access to
those matches go with it (ADR-0008 amendment, known limits).
