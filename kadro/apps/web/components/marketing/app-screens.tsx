import type { ReactNode } from 'react';

import { Chip } from './chip';
import { cx } from './class-names';
import { EksikSlot } from './eksik-slot';
import type { SampleCall, SampleMatch } from './content';
import {
  POSITION_NAMES,
  SAMPLE_CALLS,
  SAMPLE_DISTRICTS,
  SAMPLE_MATCH,
  SAMPLE_PAID_NUMBERS,
} from './content';
import styles from './primitives.module.css';
import { confirmedPlayers } from './squad-sheet';

/**
 * App screens for {@link DeviceFrame} (`device-frame.tsx`): the Kadro app drawn in HTML and CSS
 * after the design prototype (`docs/design/prototype/app.html`), from the sample fixtures of
 * `content.ts`. They render inside the frame's dark-scheme screen, contain no links, buttons or
 * headings (the frame is one image to assistive technology) and no orange (the page keeps its one
 * accent action). Each screen comes with the label the frame needs.
 *
 * - `MatchScreen({ match? })`: match detail: count, kick-off, venue, the RSVP control with
 *   "Geliyorum" chosen, the fee split and the first players. `matchScreenLabel(match?)`.
 * - `CallsScreen({ calls?, districts? })`: the Eksik Var list: district filter and call rows with
 *   the missing count as an outlined numeral. `callsScreenLabel(calls?)`.
 * - `TeamScreen({ match? })`: the team: name, district, roles and the invite row.
 *   `teamScreenLabel(match?)`.
 * - `FeeScreen({ match?, paid? })`: the fee split and who has paid. `feeScreenLabel(match?)`.
 */

const LIRA = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });

/** `2800` → `2.800 ₺`, `215.384…` → `215,38 ₺`. */
export function formatLira(value: number): string {
  return `${LIRA.format(value)} ₺`;
}

function perPerson(match: SampleMatch, players: number): number {
  return players > 0 ? match.fee / players : match.fee;
}

function ScreenBar({ back, title }: { back?: string; title?: string }) {
  return (
    <p className={styles.appBar}>
      {back === undefined ? null : <span className={styles.appBack}>‹ {back}</span>}
      {title === undefined ? null : <span className={styles.appBarTitle}>{title}</span>}
    </p>
  );
}

function PlayerRow({
  number,
  name,
  trailing,
}: {
  number: number;
  name: string;
  trailing: ReactNode;
}) {
  return (
    <li className={styles.appRow}>
      <span className={styles.appBib}>{number}</span>
      <span className={styles.appRowName}>{name}</span>
      {trailing}
    </li>
  );
}

export function matchScreenLabel(match: SampleMatch = SAMPLE_MATCH): string {
  const confirmed = confirmedPlayers(match).length;
  return `Kadro uygulamasında maç ekranı: ${match.weekday} ${match.kickOff}, ${String(confirmed)}/${String(match.capacity)} gelen, katılım seçimi geliyorum, ${formatLira(match.fee)} saha ücreti kişi başı ${formatLira(perPerson(match, confirmed))}.`;
}

export function MatchScreen({ match = SAMPLE_MATCH }: { readonly match?: SampleMatch }) {
  const players = confirmedPlayers(match);
  const confirmed = players.length;
  return (
    <div className={styles.appScreen}>
      <ScreenBar back="Maçlar" />
      <p className={styles.appTeam}>
        <Chip tone="sample" size="sm">
          ÖRNEK
        </Chip>
        <span className={styles.appTeamName}>{match.team}</span>
      </p>
      <div className={styles.appMatchHead}>
        <p className={styles.appWhen}>
          <span className={styles.appCaption}>
            {match.weekday} {match.date}
          </span>
          <span className={styles.appNumeral}>{match.kickOff}</span>
        </p>
        <p className={styles.appCount}>
          <span className={styles.appNumeralLarge}>
            {confirmed}
            <span className={styles.appMuted}>/{match.capacity}</span>
          </span>
          <span className={styles.appCaption}>gelen</span>
        </p>
      </div>
      <p className={styles.appVenue}>
        <span>{match.venue}</span>
        <Chip size="sm">{match.format}</Chip>
      </p>
      <p className={styles.appLabel}>Katılımın</p>
      <p className={styles.appSegments}>
        <span className={cx(styles.appSegment, styles.appSegmentOn)}>Geliyorum</span>
        <span className={styles.appSegment}>Belki</span>
        <span className={styles.appSegment}>Gelmiyorum</span>
      </p>
      <p className={styles.appLabel}>Saha ücreti</p>
      <p className={styles.appFee}>
        <span className={styles.appFeePart}>
          <span className={styles.appNumeral}>{formatLira(match.fee)}</span>
          <span className={styles.appCaption}>toplam</span>
        </span>
        <span className={styles.appFeePart}>
          <span className={styles.appNumeral}>{confirmed}</span>
          <span className={styles.appCaption}>gelen</span>
        </span>
        <span className={styles.appFeePart}>
          <span className={cx(styles.appNumeral, styles.appPrimary)}>
            {formatLira(perPerson(match, confirmed))}
          </span>
          <span className={styles.appCaption}>kişi başı</span>
        </span>
      </p>
      <p className={styles.appLabel}>Gelenler ({confirmed})</p>
      <ul className={styles.appList}>
        {players.slice(0, 4).map((player) => (
          <PlayerRow
            key={player.number}
            number={player.number}
            name={player.name ?? ''}
            trailing={<Chip size="sm">{POSITION_NAMES[player.position]}</Chip>}
          />
        ))}
      </ul>
    </div>
  );
}

export function callsScreenLabel(calls: readonly SampleCall[] = SAMPLE_CALLS): string {
  const first = calls[0];
  const summary =
    first === undefined
      ? 'açık ilan yok'
      : `${String(calls.length)} açık ilan, ilki ${first.day} ${first.time}, ${String(first.missing)} eksik, ${first.position.toLocaleLowerCase('tr-TR')} aranıyor`;
  return `Kadro uygulamasında Eksik Var listesi: ${summary}.`;
}

export function CallsScreen({
  calls = SAMPLE_CALLS,
  districts = SAMPLE_DISTRICTS,
}: {
  readonly calls?: readonly SampleCall[];
  readonly districts?: readonly string[];
}) {
  return (
    <div className={styles.appScreen}>
      <p className={styles.appTitle}>Eksik Var</p>
      <p className={styles.appChips}>
        {districts.map((district, index) => (
          <Chip key={district} size="sm" tone={index === 0 ? 'selected' : 'default'}>
            {district}
          </Chip>
        ))}
      </p>
      <ul className={styles.appCalls}>
        {calls.map((call) => (
          <li key={`${call.team}-${call.day}`} className={styles.appCall}>
            <span className={styles.appCallCount}>
              <EksikSlot number={call.missing} size={40} />
              <span className={styles.appCaption}>eksik</span>
            </span>
            <span className={styles.appCallBody}>
              <span className={styles.appCallWhen}>
                <span className={styles.appCaption}>{call.day}</span>
                <span className={styles.appNumeralSmall}>{call.time}</span>
              </span>
              <span className={styles.appCallTeam}>{call.team}</span>
              <span className={styles.appChips}>
                <Chip size="sm">{call.position}</Chip>
                <Chip size="sm">{call.level}</Chip>
                <Chip size="sm">{call.format}</Chip>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function teamScreenLabel(match: SampleMatch = SAMPLE_MATCH): string {
  return `Kadro uygulamasında takım ekranı: ${match.team}, ${match.district}, ${String(confirmedPlayers(match).length)} oyuncu, roller kaptan, yardımcı kaptan ve oyuncu, davet bağlantısı ve QR kod.`;
}

export function TeamScreen({ match = SAMPLE_MATCH }: { readonly match?: SampleMatch }) {
  const players = confirmedPlayers(match);
  const roles = ['Kaptan', 'Yardımcı kaptan'];
  return (
    <div className={styles.appScreen}>
      <ScreenBar back="Takımlar" />
      <p className={styles.appTeam}>
        <Chip tone="sample" size="sm">
          ÖRNEK
        </Chip>
        <span className={styles.appTeamName}>{match.team}</span>
      </p>
      <p className={styles.appCaption}>
        {match.district}, İstanbul. {players.length} oyuncu
      </p>
      <p className={styles.appInvite}>
        <span>Davet bağlantısı</span>
        <Chip size="sm">QR kod</Chip>
      </p>
      <p className={styles.appLabel}>Oyuncular</p>
      <ul className={styles.appList}>
        {players.slice(0, 6).map((player, index) => (
          <PlayerRow
            key={player.number}
            number={player.number}
            name={player.name ?? ''}
            trailing={
              <Chip size="sm" tone={index < roles.length ? 'selected' : 'default'}>
                {roles.at(index) ?? 'Oyuncu'}
              </Chip>
            }
          />
        ))}
      </ul>
    </div>
  );
}

export function feeScreenLabel(match: SampleMatch = SAMPLE_MATCH): string {
  return `Kadro uygulamasında saha ücreti ekranı: ${formatLira(match.fee)} toplam, ${String(match.capacity)} oyuncu, kişi başı ${formatLira(perPerson(match, match.capacity))}, ödeyenler işaretli.`;
}

export function FeeScreen({
  match = SAMPLE_MATCH,
  paid = SAMPLE_PAID_NUMBERS,
}: {
  readonly match?: SampleMatch;
  readonly paid?: readonly number[];
}) {
  const players = confirmedPlayers(match);
  const paidCount = players.filter((player) => paid.includes(player.number)).length;
  return (
    <div className={styles.appScreen}>
      <ScreenBar back="Maç" title="Saha ücreti" />
      <p className={styles.appFee}>
        <span className={styles.appFeePart}>
          <span className={styles.appNumeral}>{formatLira(match.fee)}</span>
          <span className={styles.appCaption}>toplam</span>
        </span>
        <span className={styles.appFeePart}>
          <span className={styles.appNumeral}>{match.capacity}</span>
          <span className={styles.appCaption}>oyuncu</span>
        </span>
        <span className={styles.appFeePart}>
          <span className={cx(styles.appNumeral, styles.appPrimary)}>
            {formatLira(perPerson(match, match.capacity))}
          </span>
          <span className={styles.appCaption}>kişi başı</span>
        </span>
      </p>
      <p className={styles.appCaption}>Para uygulamada el değiştirmez. Ödeyeni kaptan işaretler.</p>
      <p className={styles.appLabel}>
        Ödeyenler {paidCount}/{match.capacity}
      </p>
      <ul className={styles.appList}>
        {players.slice(0, 6).map((player) => (
          <PlayerRow
            key={player.number}
            number={player.number}
            name={player.name ?? ''}
            trailing={
              paid.includes(player.number) ? (
                <Chip size="sm" tone="in">
                  Ödendi
                </Chip>
              ) : (
                <Chip size="sm">Ödenmedi</Chip>
              )
            }
          />
        ))}
      </ul>
    </div>
  );
}
