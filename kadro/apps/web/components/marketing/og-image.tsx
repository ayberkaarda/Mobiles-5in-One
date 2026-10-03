import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ImageResponse } from 'next/og';

import { POSITION_NAMES, SAMPLE_MATCH, type SamplePlayer } from './content';
import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from './og';
import { SITE_TITLE } from './site';

/**
 * Card image renderer (ADR-0083, ADR-0084): `next/og` (`ImageResponse`, bundled with Next.js)
 * with the light scheme of `packages/brand/theme/tokens.json`, the ink wordmark of
 * `packages/brand/logo` and the static Archivo instances of `packages/brand/fonts/archivo/static`
 * (the renderer cannot read variable fonts). The right half is the squad sheet of the sample
 * match: the squad count as a kit numeral and the pitch with every player on their number and the
 * open slot as the outlined eksik marker. Everything is read from the repository; nothing is
 * fetched. The routes under `app/og/` are prerendered by `next build`, so the files are read at
 * build time.
 */

/** Palette entries of `packages/brand/theme/tokens.json` used on the card (checked by a test). */
export const OG_PALETTE = {
  chalkWhite: '#F5F6F1',
  white: '#FFFFFF',
  ink: '#0F1A14',
  neutral: '#4E5E55',
  chalkLine: '#D3D9D0',
  pitchGreenText: '#17704A',
  turfDeep: '#0E5B36',
  cardYellow: '#F2C230',
} as const;

/** Static Archivo instances of `packages/brand/fonts/archivo/static` used on the card. */
export const OG_FONT_FILES = {
  body: 'Archivo-Regular.ttf',
  bodyStrong: 'Archivo-SemiBold.ttf',
  numeral: 'ArchivoCondensed-Bold.ttf',
  display: 'ArchivoCondensed-ExtraBold.ttf',
} as const;

/** Font directory of `packages/brand`, relative to the web app directory. */
export const OG_FONT_DIR = '../../packages/brand/fonts/archivo/static';

/** Ink wordmark of `packages/brand` (for light grounds), relative to the web app directory. */
export const OG_WORDMARK_FILE = '../../packages/brand/logo/kadro-wordmark.svg';

/**
 * Shared caches may keep a card for a day and serve it stale for a week while refetching. The
 * paths carry no build hash, so a card is not `immutable`: a new build may change it.
 */
export const OG_CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800';

/**
 * Wordmark view box is 3152 x 861 (3.66:1, `packages/brand/logo`). `next/og` stretches an image
 * to its box, so the box keeps that ratio.
 */
export const OG_WORDMARK_BOX = { width: 234, height: 64 } as const;

/**
 * The paths are spelled out from `process.cwd()` (the web app directory that `next build` runs
 * in) so the file tracer includes these files only, not the whole project.
 */
async function fontFile(name: string): Promise<Buffer> {
  const file = path.join(
    process.cwd(),
    '..',
    '..',
    'packages',
    'brand',
    'fonts',
    'archivo',
    'static',
    name,
  );
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- names from OG_FONT_FILES
  return readFile(file);
}

/** {@link OG_WORDMARK_FILE}, spelled out for the tracer. */
async function wordmarkFile(): Promise<Buffer> {
  return readFile(
    path.join(process.cwd(), '..', '..', 'packages', 'brand', 'logo', 'kadro-wordmark.svg'),
  );
}

export interface OgCard {
  /** Small line above the title, for example "Blog". */
  readonly eyebrow: string | null;
  readonly title: string;
  readonly subtitle: string;
}

/** Title size steps so a long article title still fits in three lines. */
function titleSize(title: string): number {
  if (title.length <= 32) {
    return 88;
  }
  return title.length <= 56 ? 72 : 60;
}

/** Pitch of the card: the 520 x 336 diagram of `pitch-diagram.tsx` scaled to the sheet. */
const PITCH = { width: 412, height: 266 } as const;
const PITCH_SCALE = PITCH.width / 520;
const FIELD = {
  x: Math.round(20 * PITCH_SCALE),
  y: Math.round(20 * PITCH_SCALE),
  width: Math.round(480 * PITCH_SCALE),
  height: Math.round(296 * PITCH_SCALE),
} as const;
const MARKER = 30;
const CHALK = 2;

function markerCentre(player: SamplePlayer): { x: number; y: number } {
  return {
    x: Math.round(FIELD.x + (player.x / 100) * FIELD.width),
    y: Math.round(FIELD.y + (player.y / 100) * FIELD.height),
  };
}

/** A player disc (chalk, ink number) or the open slot (dashed ring, outlined number). */
function Marker({ player }: { player: SamplePlayer }) {
  const { x, y } = markerCentre(player);
  const open = player.name === null;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - MARKER / 2,
        top: y - MARKER / 2,
        width: MARKER,
        height: MARKER,
        borderRadius: MARKER / 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Archivo Condensed',
        fontWeight: 700,
        fontSize: 17,
        ...(open
          ? {
              backgroundColor: OG_PALETTE.turfDeep,
              border: `${String(CHALK)}px dashed ${OG_PALETTE.chalkWhite}`,
              color: OG_PALETTE.turfDeep,
              WebkitTextStroke: `1px ${OG_PALETTE.chalkWhite}`,
            }
          : { backgroundColor: OG_PALETTE.chalkWhite, color: OG_PALETTE.ink }),
      }}
    >
      {String(player.number)}
    </div>
  );
}

/** The squad sheet: count, sample tag, match line and the pitch with the open slot. */
function SquadSheet() {
  const confirmed = SAMPLE_MATCH.players.filter((player) => player.name !== null).length;
  const open = SAMPLE_MATCH.players.find((player) => player.name === null);
  const openCentre = open === undefined ? null : markerCentre(open);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: PITCH.width + 56,
        padding: 28,
        backgroundColor: OG_PALETTE.white,
        border: `1px solid ${OG_PALETTE.chalkLine}`,
        borderRadius: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
        <div
          style={{
            display: 'flex',
            padding: '2px 8px',
            borderRadius: 4,
            backgroundColor: OG_PALETTE.cardYellow,
            color: OG_PALETTE.ink,
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: 1,
          }}
        >
          ÖRNEK
        </div>
        <div style={{ marginLeft: 10, fontSize: 22, fontWeight: 600 }}>{SAMPLE_MATCH.team}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 20 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            flexShrink: 0,
            fontFamily: 'Archivo Condensed',
            fontWeight: 800,
            lineHeight: 0.9,
          }}
        >
          <div style={{ display: 'flex', fontSize: 104, color: OG_PALETTE.ink }}>
            {String(confirmed)}
          </div>
          <div
            style={{ display: 'flex', fontSize: 56, color: OG_PALETTE.neutral, paddingBottom: 4 }}
          >
            {`/${String(SAMPLE_MATCH.capacity)}`}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 1,
            marginLeft: 20,
            paddingBottom: 4,
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 600 }}>gelen oyuncu</div>
          <div style={{ marginTop: 6, fontSize: 20, color: OG_PALETTE.neutral }}>
            {`${SAMPLE_MATCH.weekday} ${SAMPLE_MATCH.kickOff}, ${SAMPLE_MATCH.format}`}
          </div>
          {open === undefined ? null : (
            <div style={{ marginTop: 4, fontSize: 20, color: OG_PALETTE.neutral }}>
              {`${POSITION_NAMES[open.position]} eksik`}
            </div>
          )}
        </div>
      </div>
      <div
        style={{
          position: 'relative',
          display: 'flex',
          width: PITCH.width,
          height: PITCH.height,
          borderRadius: 8,
          backgroundColor: OG_PALETTE.turfDeep,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: FIELD.x,
            top: FIELD.y,
            width: FIELD.width,
            height: FIELD.height,
            border: `${String(CHALK)}px solid ${OG_PALETTE.chalkWhite}`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: FIELD.x + FIELD.width / 2 - CHALK / 2,
            top: FIELD.y,
            width: CHALK,
            height: FIELD.height,
            backgroundColor: OG_PALETTE.chalkWhite,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: FIELD.x + FIELD.width / 2 - 32,
            top: FIELD.y + FIELD.height / 2 - 32,
            width: 64,
            height: 64,
            borderRadius: 32,
            border: `${String(CHALK)}px solid ${OG_PALETTE.chalkWhite}`,
          }}
        />
        {SAMPLE_MATCH.players.map((player) => (
          <Marker key={player.number} player={player} />
        ))}
        {openCentre === null ? null : (
          <div
            style={{
              position: 'absolute',
              left: openCentre.x - 40,
              top: openCentre.y + MARKER / 2 + 6,
              width: 80,
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                display: 'flex',
                padding: '1px 4px',
                backgroundColor: OG_PALETTE.turfDeep,
                color: OG_PALETTE.white,
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: 1,
              }}
            >
              EKSİK
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** A 1200 x 630 PNG card: chalk ground, wordmark and title on the left, the squad sheet right. */
export async function renderOgImage(card: OgCard): Promise<ImageResponse> {
  const [body, bodyStrong, numeral, display, wordmark] = await Promise.all([
    fontFile(OG_FONT_FILES.body),
    fontFile(OG_FONT_FILES.bodyStrong),
    fontFile(OG_FONT_FILES.numeral),
    fontFile(OG_FONT_FILES.display),
    wordmarkFile(),
  ]);
  const wordmarkSrc = `data:image/svg+xml;base64,${wordmark.toString('base64')}`;
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '64px 72px',
        backgroundColor: OG_PALETTE.chalkWhite,
        color: OG_PALETTE.ink,
        fontFamily: 'Archivo',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          height: '100%',
          width: 540,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- rendered to PNG by next/og, not HTML */}
        <img
          src={wordmarkSrc}
          width={OG_WORDMARK_BOX.width}
          height={OG_WORDMARK_BOX.height}
          alt="Kadro"
        />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {card.eyebrow === null ? null : (
            <div
              style={{
                fontSize: 28,
                fontWeight: 600,
                color: OG_PALETTE.pitchGreenText,
                marginBottom: 12,
              }}
            >
              {card.eyebrow}
            </div>
          )}
          <div
            style={{
              fontFamily: 'Archivo Condensed',
              fontSize: titleSize(card.title),
              fontWeight: 800,
              lineHeight: 1.02,
            }}
          >
            {card.title}
          </div>
          <div
            style={{
              marginTop: 20,
              fontSize: 28,
              lineHeight: 1.35,
              color: OG_PALETTE.neutral,
            }}
          >
            {card.subtitle}
          </div>
        </div>
        <div style={{ display: 'flex', fontSize: 24, fontWeight: 600 }}>{SITE_TITLE}</div>
      </div>
      <SquadSheet />
    </div>,
    {
      width: OG_IMAGE_WIDTH,
      height: OG_IMAGE_HEIGHT,
      headers: { 'Cache-Control': OG_CACHE_CONTROL },
      fonts: [
        { name: 'Archivo', data: body, weight: 400, style: 'normal' },
        { name: 'Archivo', data: bodyStrong, weight: 600, style: 'normal' },
        { name: 'Archivo Condensed', data: numeral, weight: 700, style: 'normal' },
        { name: 'Archivo Condensed', data: display, weight: 800, style: 'normal' },
      ],
    },
  );
}
