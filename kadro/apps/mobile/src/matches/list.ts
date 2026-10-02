import { type MatchSummary } from './contracts';
import { mvpWindowOpen } from './permissions';

const RECENT_START_MS = 3 * 60 * 60 * 1000;

/**
 * Matches of the Maçlar tab, in start order: everything still ahead (`draft`, `open`, `locked`,
 * started at most 3 h ago) and played matches whose MVP vote is still open (ADR-0036).
 */
export function tabMatches(
  matches: readonly MatchSummary[],
  now: number = Date.now(),
): MatchSummary[] {
  return matches
    .filter((match) => {
      if (match.status === 'played') {
        return mvpWindowOpen(match, now);
      }
      return match.status !== 'cancelled' && Date.parse(match.startsAt) >= now - RECENT_START_MS;
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
