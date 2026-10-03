import { withoutTag } from '../profile/initials';
import { type PitchMarker } from '../ui';
import { type LineupSide, type Position } from './contracts';

/** A confirmed player as drawn on the lineup pitch. */
export interface PitchPlayer {
  readonly id: string;
  /** Kit number shown on the marker (the player's place in the confirmed list, from 1). */
  readonly number: number;
  readonly name: string;
  readonly position: Position | null;
}

/** View box of the pitch diagram (`pitchDiagram.viewBox`): side A in the top half. */
const WIDTH = 300;
/** Touchline inset of the diagram; markers keep clear of it. */
const INSET = 10;

/**
 * Vertical placement per side, in view box units. `PitchView` draws a name 30 below the marker
 * centre (radius 18 + 12) and the "Kaleci eksik" caption 4 below it, both 11 pt; the spots keep
 * those labels off the chalk lines (goal box 32 / 428, penalty box 70 / 390, halfway 230), so
 * side B is not a plain mirror of side A: its names also hang below the markers.
 */
interface SideGeometry {
  /** Keeper with a player: the name sits between the lines. */
  readonly keeper: number;
  /** Empty keeper spot: the caption beside it sits between the lines. */
  readonly emptyKeeper: number;
  /** Outfield row nearest the own goal, and nearest the halfway line. */
  readonly goalRow: number;
  readonly halfwayRow: number;
}

const GEOMETRY: Readonly<Record<LineupSide, SideGeometry>> = {
  A: { keeper: 54, emptyKeeper: 54, goalRow: 110, halfwayRow: 190 },
  B: { keeper: 390, emptyKeeper: 409, goalRow: 332, halfwayRow: 258 },
};

/** Names are left out once a half holds more than two outfield rows (they would touch markers). */
const MAX_NAMED_ROWS = 2;

const POSITION_ORDER: readonly (Position | null)[] = ['GK', 'DEF', 'MID', 'FWD', null];

/**
 * "Emre Kaya" -> "E. Kaya"; a single word stays as it is, cut to ten characters. A leading tag is
 * skipped: "[ÖRNEK] Deniz Kaptan" -> "D. Kaptan".
 */
export function shortName(name: string): string {
  const words = withoutTag(name).split(/\s+/u).filter(Boolean);
  const last = words.at(-1) ?? '';
  const first = words[0] ?? '';
  if (words.length < 2) {
    return first.length > 10 ? `${first.slice(0, 9)}.` : first;
  }
  return `${Array.from(first)[0] ?? ''}. ${last.length > 10 ? `${last.slice(0, 9)}.` : last}`;
}

function rowSizes(count: number): number[] {
  if (count <= 0) {
    return [];
  }
  const perRow = count <= 6 ? 3 : 4;
  const rows = Math.ceil(count / perRow);
  const base = Math.floor(count / rows);
  const extra = count % rows;
  return Array.from({ length: rows }, (_, index) => base + (index < extra ? 1 : 0));
}

interface Spot {
  readonly x: number;
  readonly y: number;
}

/** Keeper spots plus `outfield` spots of one side (side A in the top half). */
function spots(
  outfield: number,
  side: LineupSide,
): { keeper: Spot; emptyKeeper: Spot; field: Spot[]; rows: number } {
  // eslint-disable-next-line security/detect-object-injection -- side is a typed LineupSide
  const geometry = GEOMETRY[side];
  const sizes = rowSizes(outfield);
  const field: Spot[] = [];
  sizes.forEach((size, row) => {
    const y =
      sizes.length === 1
        ? (geometry.goalRow + geometry.halfwayRow) / 2
        : geometry.goalRow + ((geometry.halfwayRow - geometry.goalRow) * row) / (sizes.length - 1);
    for (let index = 0; index < size; index += 1) {
      const x = INSET + ((WIDTH - INSET * 2) * (index + 1)) / (size + 1);
      field.push({ x: Math.round(x), y: Math.round(y) });
    }
  });
  return {
    keeper: { x: WIDTH / 2, y: geometry.keeper },
    emptyKeeper: { x: WIDTH / 2, y: geometry.emptyKeeper },
    field,
    rows: sizes.length,
  };
}

function byPosition(players: readonly PitchPlayer[]): PitchPlayer[] {
  return POSITION_ORDER.flatMap((position) =>
    players.filter((player) => player.position === position),
  );
}

/**
 * Markers of one side: the keeper in front of the goal, the others in rows towards the halfway
 * line, ordered goalkeepers, defenders, midfielders, forwards. With a known `capacity` the
 * missing players are drawn as empty (eksik) markers; when the side has no goalkeeper and is not
 * full, the keeper spot stays empty and carries `keeperMissing`.
 */
export function sideMarkers(
  side: LineupSide,
  players: readonly PitchPlayer[],
  capacity: number | null,
  keeperMissing: string,
): PitchMarker[] {
  const total = Math.max(players.length, capacity ?? players.length);
  if (total === 0) {
    return [];
  }
  const ordered = byPosition(players);
  const { keeper, emptyKeeper, field, rows } = spots(total - 1, side);
  const named = rows <= MAX_NAMED_ROWS;
  const marker = (player: PitchPlayer, spot: Spot): PitchMarker => ({
    id: player.id,
    x: spot.x,
    y: spot.y,
    number: player.number,
    ...(named ? { name: shortName(player.name) } : {}),
  });
  const empty = (index: number, spot: Spot, label?: string): PitchMarker => ({
    id: `${side}-empty-${index}`,
    x: spot.x,
    y: spot.y,
    empty: true,
    ...(label === undefined ? {} : { emptyLabel: label }),
  });

  const hasKeeper = ordered[0]?.position === 'GK';
  const keeperEmpty = !hasKeeper && players.length < total;
  const result: PitchMarker[] = [];
  const outfield = keeperEmpty ? ordered : ordered.slice(1);
  const first = ordered[0];
  if (keeperEmpty || first === undefined) {
    result.push(empty(0, emptyKeeper, keeperMissing));
  } else {
    result.push(marker(first, keeper));
  }
  field.forEach((spot, index) => {
    const player = outfield.at(index);
    result.push(player === undefined ? empty(index + 1, spot) : marker(player, spot));
  });
  return result;
}

/** Empty slots of a side, `0` when the capacity is unknown (guest view). */
export function missingCount(players: number, capacity: number | null): number {
  return capacity === null ? 0 : Math.max(0, capacity - players);
}
