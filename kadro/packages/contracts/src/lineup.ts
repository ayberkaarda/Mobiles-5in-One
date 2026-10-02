import { type LineupAssignment, type LineupSide } from './matches.js';
import { type Position } from './users.js';

export interface LineupCandidate {
  readonly userId: string;
  readonly position: Position | null;
}

const POSITION_ORDER: readonly (Position | null)[] = ['GK', 'DEF', 'MID', 'FWD', null];

/**
 * Deterministic auto-balance suggestion (spec §3 story 4, ADR-0035), shared by the mobile app and
 * server tests; the server never applies it on its own. Goalkeepers are placed first, then
 * defenders, midfielders, forwards and players without a position, each group in input order.
 * Each player goes to the side with fewer players of the same position, then fewer players in
 * total, then alternating starting with `A`. A side holds at most `ceil(slots / 2)` players;
 * players beyond both capacities stay unassigned.
 */
export function suggestLineup(
  players: readonly LineupCandidate[],
  slots: number,
): LineupAssignment[] {
  const capacity = Math.ceil(slots / 2);
  const total = new Map<LineupSide, number>([
    ['A', 0],
    ['B', 0],
  ]);
  const count = (counts: ReadonlyMap<LineupSide, number>, side: LineupSide): number =>
    counts.get(side) ?? 0;
  const result: LineupAssignment[] = [];

  for (const position of POSITION_ORDER) {
    const counts = new Map<LineupSide, number>([
      ['A', 0],
      ['B', 0],
    ]);
    for (const player of players) {
      if (player.position !== position) {
        continue;
      }
      const open = (['A', 'B'] as const).filter((side) => count(total, side) < capacity);
      if (open.length === 0) {
        continue;
      }
      const [first, second] = open;
      let side: LineupSide = first ?? 'A';
      if (first !== undefined && second !== undefined) {
        if (count(counts, 'A') !== count(counts, 'B')) {
          side = count(counts, 'A') < count(counts, 'B') ? 'A' : 'B';
        } else if (count(total, 'A') !== count(total, 'B')) {
          side = count(total, 'A') < count(total, 'B') ? 'A' : 'B';
        } else {
          side = result.length % 2 === 0 ? 'A' : 'B';
        }
      }
      counts.set(side, count(counts, side) + 1);
      total.set(side, count(total, side) + 1);
      result.push({ userId: player.userId, side });
    }
  }
  return result;
}
