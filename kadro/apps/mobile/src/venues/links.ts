/**
 * Routes of the venue screens. A venue opens at `/saha/<slug>`, the venue path of the app-link
 * set (ADR-0045). The add form is the static `/saha/yeni`: server slugs are always
 * `<name>-<district>` (at least one dash, matrix §4.5), so no venue slug can be `yeni`.
 */
export const VENUES_HOME = '/sahalar';
export const NEW_VENUE_HREF = '/saha/yeni';

export function venueHref(slug: string): string {
  return `/saha/${encodeURIComponent(slug)}`;
}

/**
 * The create-match screen of a team with this venue chosen. Only the venue id travels in the
 * route; the screen takes the name from the app's cached venue data.
 */
export function matchAtVenueHref(teamId: string, venueId: string): string {
  return `/takim/${encodeURIComponent(teamId)}/mac/yeni?venue=${encodeURIComponent(venueId)}`;
}
