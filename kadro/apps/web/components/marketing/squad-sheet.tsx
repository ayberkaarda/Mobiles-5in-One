import { Chip } from './chip';
import { cx } from './class-names';
import type { PositionCode, SampleMatch, SamplePlayer } from './content';
import { POSITION_NAMES } from './content';
import { KitNumeral } from './kit-numeral';
import { PitchDiagram, type PitchMarker } from './pitch-diagram';
import styles from './primitives.module.css';

/**
 * SquadSheet({ match, animated?, className? }): the squad sheet pinned to the wall (direction §2,
 * §4.4 home hero): the squad count in `numeralXL` (`13/14`), the sample match (team with the
 * `ÖRNEK` tag, weekday and kick-off in numerals, venue and format), the pitch diagram with every
 * player on their kit number and the open slot as the outlined eksik marker (`EKSİK` / position),
 * and the roster of both sides with the open slot named.
 *
 * - `match`: a {@link SampleMatch} fixture from `content.ts` (a player with `name: null` is the
 *   open slot). Counts are derived from it, never typed into a page.
 * - `animated`: pass to the pitch diagram (the one load-time draw; home hero only).
 *
 * Helpers for other lineup figures from the same fixture: `confirmedPlayers(match)`,
 * `openSlots(match)`, `lineupMarkers(match)` (markers for `PitchDiagram`), `lineupTitle(match)`
 * (its accessible name) and `lineupBalance(match)` (players per position and side).
 *
 * Server component, inline SVG, no image request; the H1 next to it stays the largest paint.
 */
export function confirmedPlayers(match: SampleMatch): readonly SamplePlayer[] {
  return match.players.filter((player) => player.name !== null);
}

export function openSlots(match: SampleMatch): readonly SamplePlayer[] {
  return match.players.filter((player) => player.name === null);
}

/** Players per position on side A and side B (open slots not counted): `KL 1-0, DF 3-3, ...`. */
export function lineupBalance(
  match: SampleMatch,
): readonly { readonly position: PositionCode; readonly a: number; readonly b: number }[] {
  const codes: readonly PositionCode[] = ['KL', 'DF', 'OS', 'FV'];
  const count = (position: PositionCode, side: 'A' | 'B') =>
    confirmedPlayers(match).filter((player) => player.position === position && player.side === side)
      .length;
  return codes.map((position) => ({ position, a: count(position, 'A'), b: count(position, 'B') }));
}

/** Markers of the pitch diagram for a sample match: the open slot is the eksik marker. */
export function lineupMarkers(match: SampleMatch): readonly PitchMarker[] {
  return match.players.map((player) =>
    player.name === null
      ? {
          x: player.x,
          y: player.y,
          number: player.number,
          empty: true,
          label: 'EKSİK',
          sublabel: POSITION_NAMES[player.position].toLocaleUpperCase('tr-TR'),
        }
      : { x: player.x, y: player.y, number: player.number },
  );
}

/** Accessible description of the lineup: both sides and the open slots. */
export function lineupTitle(match: SampleMatch): string {
  const side = (name: 'A' | 'B') => {
    const numbers = match.players
      .filter((player) => player.side === name && player.name !== null)
      .map((player) => player.number);
    return `${name} takımı ${numbers.join(', ')} numara`;
  };
  const open = openSlots(match)
    .map(
      (player) =>
        `${String(player.number)} numaralı ${POSITION_NAMES[player.position].toLocaleLowerCase('tr-TR')} yeri boş`,
    )
    .join(', ');
  return `${match.format} diziliş: ${side('A')}; ${side('B')}${open === '' ? '' : `; ${open}`}.`;
}

/**
 * LineupBoard({ match, className? }): the lineup of a sample match as a full-width figure: the
 * pitch diagram (open slot as the eksik marker) and the balance per position as numeral pairs
 * (`KL 1-0`), the "Diziliş" rows of the home page and /ozellikler.
 */
export function LineupBoard({
  match,
  className,
}: {
  readonly match: SampleMatch;
  readonly className?: string | undefined;
}) {
  return (
    <figure className={cx(styles.lineup, className)}>
      <PitchDiagram title={lineupTitle(match)} markers={lineupMarkers(match)} />
      <dl className={styles.balance} aria-label="Mevkiye göre denge, A takımı ve B takımı">
        {lineupBalance(match).map((item) => (
          <div key={item.position} className={styles.balanceItem}>
            <dt className={styles.balanceTerm}>
              <abbr title={POSITION_NAMES[item.position]}>{item.position}</abbr>
            </dt>
            <dd className={styles.balanceValue}>{`${String(item.a)}-${String(item.b)}`}</dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}

function Roster({ players, side }: { players: readonly SamplePlayer[]; side: 'A' | 'B' }) {
  return (
    <ol className={styles.rosterSide} aria-label={`${side} takımı`}>
      {players
        .filter((player) => player.side === side)
        .map((player) => (
          <li
            key={player.number}
            className={cx(styles.rosterRow, player.name === null && styles.rosterOpen)}
          >
            <span className={styles.rosterNumber}>{player.number}</span>
            <span className={styles.rosterName}>
              {player.name ?? `${POSITION_NAMES[player.position]} aranıyor`}
            </span>
            <abbr className={styles.rosterPosition} title={POSITION_NAMES[player.position]}>
              {player.position}
            </abbr>
          </li>
        ))}
    </ol>
  );
}

export function SquadSheet({
  match,
  animated = false,
  className,
}: {
  readonly match: SampleMatch;
  readonly animated?: boolean;
  readonly className?: string | undefined;
}) {
  const confirmed = confirmedPlayers(match).length;
  const open = openSlots(match);
  const summary = `Örnek kadro: ${match.team}, ${match.weekday} ${match.kickOff}, ${String(match.capacity)} kişilik kadroda ${String(confirmed)} oyuncu geliyor${
    open.length === 0
      ? '.'
      : `, ${open.map((player) => POSITION_NAMES[player.position].toLocaleLowerCase('tr-TR')).join(', ')} eksik.`
  }`;
  return (
    <figure className={cx(styles.sheet, className)} aria-label={summary}>
      <div className={styles.sheetHead}>
        <KitNumeral value={confirmed} of={match.capacity} size="xl" label="gelen oyuncu" />
        <div className={styles.sheetMatch}>
          <p className={styles.sheetTeam}>
            <Chip tone="sample" size="sm">
              ÖRNEK
            </Chip>
            <span className={styles.sheetTeamName}>{match.team}</span>
          </p>
          <p className={styles.sheetWhen}>
            <span>{match.weekday}</span> <time>{match.kickOff}</time>
          </p>
          <p className={styles.sheetVenue}>
            {match.venue}, {match.format}
          </p>
        </div>
      </div>
      <PitchDiagram title={lineupTitle(match)} markers={lineupMarkers(match)} animated={animated} />
      <div className={styles.roster}>
        <Roster players={match.players} side="A" />
        <Roster players={match.players} side="B" />
      </div>
    </figure>
  );
}
