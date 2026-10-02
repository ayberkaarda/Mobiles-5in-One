import { type LineupAssignment, type LineupSide, type Position } from './contracts';

export interface LineupCandidate {
  readonly userId: string;
  readonly position: Position | null;
}

/** A side holds at most `ceil(slots / 2)` players (409 `lineup_side_full`, ADR-0035). */
export function sideCapacity(slots: number): number {
  return Math.ceil(slots / 2);
}

interface SideCounts {
  A: number;
  B: number;
}

const countOf = (counts: SideCounts, side: LineupSide): number =>
  side === 'A' ? counts.A : counts.B;

function bump(counts: SideCounts, side: LineupSide): void {
  if (side === 'A') {
    counts.A += 1;
  } else {
    counts.B += 1;
  }
}

const POSITION_ORDER: readonly (Position | null)[] = ['GK', 'DEF', 'MID', 'FWD', null];

/**
 * The auto-balance suggestion of ADR-0035, the same algorithm as `suggestLineup` in
 * `packages/contracts` (the contracts package is not bundled into the app; a test runs both on
 * the same inputs). Goalkeepers first, then defenders, midfielders, forwards and players without
 * a position, each group in input order; each player goes to the side with fewer players of the
 * same position, then fewer players in total, then alternating starting with `A`. Players beyond
 * both capacities stay unassigned. Only a suggestion: the captain saves it or changes it.
 */
export function suggestLineup(
  players: readonly LineupCandidate[],
  slots: number,
): LineupAssignment[] {
  const capacity = sideCapacity(slots);
  const total: SideCounts = { A: 0, B: 0 };
  const result: LineupAssignment[] = [];

  for (const position of POSITION_ORDER) {
    const counts: SideCounts = { A: 0, B: 0 };
    for (const player of players) {
      if (player.position !== position) {
        continue;
      }
      const open = (['A', 'B'] as const).filter((side) => countOf(total, side) < capacity);
      const [first, second] = open;
      if (first === undefined) {
        continue;
      }
      let side: LineupSide = first;
      if (second !== undefined) {
        if (counts.A !== counts.B) {
          side = counts.A < counts.B ? 'A' : 'B';
        } else if (total.A !== total.B) {
          side = total.A < total.B ? 'A' : 'B';
        } else {
          side = result.length % 2 === 0 ? 'A' : 'B';
        }
      }
      bump(counts, side);
      bump(total, side);
      result.push({ userId: player.userId, side });
    }
  }
  return result;
}

/** Lineup draft: side per confirmed player, `null` for the bench. */
export type LineupDraft = ReadonlyMap<string, LineupSide | null>;

/** The request body of `PUT lineup`: assigned players only, in the order of `confirmedIds`. */
export function draftToAssignments(
  draft: LineupDraft,
  confirmedIds: readonly string[],
): LineupAssignment[] {
  return confirmedIds.flatMap((userId) => {
    const side = draft.get(userId) ?? null;
    return side === null ? [] : [{ userId, side }];
  });
}

export function sideCount(draft: LineupDraft, side: LineupSide): number {
  let count = 0;
  for (const value of draft.values()) {
    if (value === side) {
      count += 1;
    }
  }
  return count;
}
