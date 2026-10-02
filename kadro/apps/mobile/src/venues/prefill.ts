import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { type MatchFormInitial } from '../matches/MatchForm';
import { cachedVenueName } from './queries';

/**
 * The create-match form's start values with the venue chosen on the venue screen
 * (`?venue=<id>`, from "Bu sahada maç kur"). The name is taken from the venue data the app read
 * from the API; an id the app has not seen (a hand-made link) leaves the form unchanged, so a
 * link can never put an arbitrary venue name on the form. The server still checks that the
 * venue is readable by the captain (footnote 10).
 */
export function useVenuePrefill(
  base: MatchFormInitial,
  venueParam: string | string[] | undefined,
): MatchFormInitial {
  const client = useQueryClient();
  const [initial] = useState<MatchFormInitial>(() => {
    if (typeof venueParam !== 'string' || venueParam === '') {
      return base;
    }
    const name = cachedVenueName(client, venueParam);
    return name === null ? base : { ...base, venue: { kind: 'directory', id: venueParam, name } };
  });
  return initial;
}
