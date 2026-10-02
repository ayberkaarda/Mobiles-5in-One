import { type MatchMemberView, type UpdateMatchRequest } from './contracts';
import { type MatchFormValues } from './MatchForm';

/**
 * Only what changed is sent (`PATCH matches/:id`). Frozen terms are never sent, so a locked match
 * cannot be refused with `match_terms_frozen` for a value the user did not touch.
 */
export function changedFields(
  match: MatchMemberView,
  values: MatchFormValues,
  frozen: boolean,
): UpdateMatchRequest | null {
  const body: { -readonly [K in keyof UpdateMatchRequest]: UpdateMatchRequest[K] } = {};
  if (values.venue.kind === 'directory') {
    if (match.venue?.id !== values.venue.id) {
      body.venueId = values.venue.id;
    }
  } else if (match.venue !== null || match.venueText !== values.venue.text) {
    body.venueText = values.venue.text;
  }
  // The form works in whole minutes; a stored start with seconds is the same start.
  if (Math.floor(Date.parse(match.startsAt) / 60_000) !== Date.parse(values.startsAt) / 60_000) {
    body.startsAt = values.startsAt;
  }
  if (!frozen) {
    if (match.format !== values.format) {
      body.format = values.format;
    }
    if (match.slots !== values.slots) {
      body.slots = values.slots;
    }
    if (match.feeTotalMinor !== values.feeTotalMinor) {
      body.feeTotalMinor = values.feeTotalMinor;
    }
  }
  return Object.keys(body).length === 0 ? null : body;
}
