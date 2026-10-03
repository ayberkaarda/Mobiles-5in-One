import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  CallsScreen,
  callsScreenLabel,
  FeeScreen,
  feeScreenLabel,
  formatLira,
  MatchScreen,
  matchScreenLabel,
  TeamScreen,
  teamScreenLabel,
} from '../../components/marketing/app-screens';
import { Chip } from '../../components/marketing/chip';
import {
  FEATURE_CLOSING_IDS,
  FEATURE_GROUPS,
  FEATURE_SECTIONS,
  HOME_HERO,
  MATCH_WEEK,
  SAMPLE_CALLS,
  SAMPLE_MATCH,
} from '../../components/marketing/content';
import { DeviceFrame } from '../../components/marketing/device-frame';
import { FactGrid } from '../../components/marketing/fact-grid';
import { PitchDiagram } from '../../components/marketing/pitch-diagram';
import {
  confirmedPlayers,
  lineupBalance,
  lineupMarkers,
  LineupBoard,
  lineupTitle,
  openSlots,
  SquadSheet,
} from '../../components/marketing/squad-sheet';
import { Timeline } from '../../components/marketing/timeline';

/**
 * Marketing primitives of direction §4 (chip, fact grid, timeline, device frame and app screens,
 * squad sheet, lineup board) and the sample fixtures they draw: semantic markup, no inline style
 * or colour literal (CSP and theming), sample labels, and counts derived from `content.ts`.
 */

function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

function words(text: string): number {
  return text.split(/\s+/).filter((word) => word !== '').length;
}

/** No inline style, colour literal, script or event handler in server-rendered markup. */
function expectThemeSafe(html: string): void {
  expect(html).not.toMatch(/\sstyle="/);
  expect(html).not.toMatch(/(fill|stroke|color)="#/);
  expect(html).not.toMatch(/<script\b|\son[a-z]+="/);
}

describe('sample fixtures (direction §8)', () => {
  it('keeps the sample match consistent: 14 slots, kit numbers 1-14, one open goalkeeper slot', () => {
    expect(SAMPLE_MATCH.players).toHaveLength(SAMPLE_MATCH.capacity);
    expect(SAMPLE_MATCH.players.map((player) => player.number)).toEqual(
      Array.from({ length: SAMPLE_MATCH.capacity }, (_, index) => index + 1),
    );
    expect(confirmedPlayers(SAMPLE_MATCH)).toHaveLength(13);
    expect(openSlots(SAMPLE_MATCH).map((player) => [player.number, player.position])).toEqual([
      [14, 'KL'],
    ]);
    for (const player of SAMPLE_MATCH.players) {
      expect(player.x).toBeGreaterThanOrEqual(0);
      expect(player.x).toBeLessThanOrEqual(100);
      expect(player.y).toBeGreaterThanOrEqual(0);
      expect(player.y).toBeLessThanOrEqual(100);
    }
  });

  it('labels every sample team as an example', () => {
    for (const call of SAMPLE_CALLS) {
      expect(call.team.startsWith('[ÖRNEK] ')).toBe(true);
    }
  });

  it('derives the fee of the week from the match: 14 × 200 ₺ of 2.800 ₺', () => {
    expect(SAMPLE_MATCH.fee / SAMPLE_MATCH.capacity).toBe(200);
    expect(MATCH_WEEK.at(-1)?.figure).toBe(
      `${String(SAMPLE_MATCH.capacity)} × ${String(SAMPLE_MATCH.fee / SAMPLE_MATCH.capacity)} ₺`,
    );
    expect(formatLira(SAMPLE_MATCH.fee)).toBe('2.800 ₺');
    expect(formatLira(SAMPLE_MATCH.fee / 13)).toBe('215,38 ₺');
  });

  it('writes the hero as three imperative lines and a lead of at most 20 words', () => {
    expect(HOME_HERO.lines).toHaveLength(3);
    expect(words(HOME_HERO.lead)).toBeLessThanOrEqual(20);
    expect(`${HOME_HERO.lines.join(' ')} ${HOME_HERO.lead}`).not.toMatch(
      /kolayca|sorunsuz|modern|yenilikçi|her şey|tek dokunuşla|!/i,
    );
  });

  it('places every feature section of /ozellikler exactly once', () => {
    const placed = [...FEATURE_GROUPS.flatMap((group) => group.sectionIds), ...FEATURE_CLOSING_IDS];
    expect([...placed].sort()).toEqual(FEATURE_SECTIONS.map((section) => section.id).sort());
    expect(FEATURE_GROUPS.map((group) => group.title)).toEqual([
      'Takım',
      'Maç ve katılım',
      'Eksik Var',
      'Saha ve ücret',
    ]);
  });
});

describe('chip', () => {
  it('renders a span label, never a link or a button', () => {
    for (const tone of ['default', 'selected', 'sample', 'in', 'maybe', 'out'] as const) {
      const html = render(<Chip tone={tone}>Kaleci</Chip>);
      expect(html).toMatch(/^<span\b[^>]*>Kaleci<\/span>$/);
    }
  });
});

describe('fact grid', () => {
  it('renders one definition list with a group per fact, figure and details as dd', () => {
    const html = render(
      <FactGrid
        items={[
          { id: 'katilim', term: 'Katılım', figure: '13/14', text: 'Bir.' },
          { term: 'Eksik', figure: '2', empty: true, details: ['İki.', 'Üç.'] },
        ]}
      />,
    );
    expect(html.match(/<dl\b/g)).toHaveLength(1);
    expect(html.match(/<dt\b/g)).toHaveLength(2);
    expect(html.match(/<dd\b/g)).toHaveLength(5);
    expect(html).toContain('id="katilim"');
    expect(html).not.toMatch(/<li\b|:\s*<\/dt>/);
  });
});

describe('timeline', () => {
  it('lists the match week in order with a time element per row and no numbered discs', () => {
    const html = render(<Timeline items={MATCH_WEEK} />);
    expect(html.match(/<li\b/g)).toHaveLength(MATCH_WEEK.length);
    expect([...html.matchAll(/<time\b[^>]*>([^<]*)<\/time>/g)].map((match) => match[1])).toEqual(
      MATCH_WEEK.map((entry) => entry.time),
    );
    expect(html.match(/<h3\b/g)).toHaveLength(MATCH_WEEK.length);
    expect(render(<Timeline items={MATCH_WEEK} headingLevel={4} />)).not.toContain('<h3');
    expectThemeSafe(html);
  });
});

describe('device frame and app screens', () => {
  const screens = [
    [<MatchScreen key="m" />, matchScreenLabel()],
    [<CallsScreen key="c" />, callsScreenLabel()],
    [<TeamScreen key="t" />, teamScreenLabel()],
    [<FeeScreen key="f" />, feeScreenLabel()],
  ] as const;

  it('draws each screen as one named image in the dark scheme, with no interactive content', () => {
    for (const [screen, label] of screens) {
      const html = render(
        <DeviceFrame label={label} caption="Ekran">
          {screen}
        </DeviceFrame>,
      );
      expect(html).toMatch(/^<figure\b/);
      expect(html).toContain('role="img"');
      expect(html).toContain(`aria-label="${label}"`);
      expect(html).toContain('data-theme="dark"');
      expect(html).toContain('<figcaption');
      expect(html).not.toMatch(/<(a|button|input|select|textarea|h[1-6])\b/);
      expect(html).not.toMatch(/<img\b/);
      expectThemeSafe(html);
    }
  });

  it('shows the sample tag and numbers derived from the fixtures', () => {
    const match = render(<MatchScreen />);
    expect(match).toContain('ÖRNEK');
    expect(match).toContain('2.800 ₺');
    expect(match).toContain('215,38 ₺');
    expect(matchScreenLabel()).toContain('13/14');
    const calls = render(<CallsScreen />);
    for (const call of SAMPLE_CALLS) {
      expect(calls).toContain(call.team);
    }
    expect(render(<FeeScreen />)).toContain('200 ₺');
  });
});

describe('pitch diagram and squad sheet', () => {
  it('draws 13 markers and one eksik marker with its two caption lines', () => {
    const html = render(<PitchDiagram title="Diziliş" markers={lineupMarkers(SAMPLE_MATCH)} />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Diziliş"');
    expect(html.match(/stroke-dasharray="4 4"/g)).toHaveLength(1);
    expect(html).toContain('>EKSİK</text>');
    expect(html).toContain('>KALECİ</text>');
    expect(html.match(/<text\b/g)).toHaveLength(14 + 2);
    expectThemeSafe(html);
  });

  it('describes the lineup and the balance from the fixture', () => {
    expect(lineupTitle(SAMPLE_MATCH)).toBe(
      '7v7 diziliş: A takımı 1, 2, 3, 4, 5, 6, 7 numara; B takımı 8, 9, 10, 11, 12, 13 numara; 14 numaralı kaleci yeri boş.',
    );
    expect(lineupBalance(SAMPLE_MATCH)).toEqual([
      { position: 'KL', a: 1, b: 0 },
      { position: 'DF', a: 3, b: 3 },
      { position: 'OS', a: 2, b: 2 },
      { position: 'FV', a: 1, b: 1 },
    ]);
  });

  it('renders the squad sheet: count 13/14, sample tag, both rosters and the open slot named', () => {
    const html = render(<SquadSheet match={SAMPLE_MATCH} animated />);
    expect(html).toMatch(/^<figure\b[^>]*aria-label="Örnek kadro: Moda Akşam FK, Perşembe 21:00/);
    expect(html).toContain('13<span');
    expect(html).toContain('/14</span>');
    expect(html).toContain('ÖRNEK');
    expect(html).toContain('aria-label="A takımı"');
    expect(html).toContain('aria-label="B takımı"');
    expect(html.match(/<li\b/g)).toHaveLength(SAMPLE_MATCH.capacity);
    expect(html).toContain('Kaleci aranıyor');
    expect(html).not.toMatch(/<h[1-6]\b/);
    expectThemeSafe(html);
  });

  it('renders the lineup board with four numeral pairs', () => {
    const html = render(<LineupBoard match={SAMPLE_MATCH} />);
    expect(html.match(/<dt\b/g)).toHaveLength(4);
    expect(html).toContain('>1-0</dd>');
    expect(html).toContain('>3-3</dd>');
    expectThemeSafe(html);
  });
});
