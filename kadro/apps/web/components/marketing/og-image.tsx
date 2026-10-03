import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ImageResponse } from 'next/og';

import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from './og';
import { SITE_TITLE } from './site';

/**
 * Card image renderer (ADR-0083): `next/og` (`ImageResponse`, bundled with Next.js) with the
 * brand palette of `packages/brand/tokens.json`, the light wordmark of `packages/brand` and static
 * Sora and Inter instances in `assets/og-fonts/`. The renderer cannot read the variable font
 * files of `packages/brand`, so the static instances are cut from them (ADR-0083 lists the
 * command). Everything is read from the repository; nothing is fetched. The routes under `app/og/`
 * are prerendered by `next build`, so the files are read at build time.
 */

/** Palette entries of `packages/brand/tokens.json` used on the card (checked by a test). */
export const OG_PALETTE = {
  nightMatch: '#0E1A14',
  chalkWhite: '#F4F6F0',
  pitchGreen: '#1B7F4B',
  orangeBall: '#FF6B1A',
  neutralOnDark: '#A8B5AD',
} as const;

/** Font files of the card in `assets/og-fonts/` of the web app. */
export const OG_FONT_FILES = {
  display: 'sora-700.ttf',
  body: 'inter-400.ttf',
  bodyStrong: 'inter-600.ttf',
} as const;

/** Wordmark of `packages/brand`, relative to the web app directory. */
export const OG_WORDMARK_FILE = '../../packages/brand/logo/kadro-wordmark-light.svg';

/**
 * Shared caches may keep a card for a day and serve it stale for a week while refetching. The
 * paths carry no build hash, so a card is not `immutable`: a new build may change it.
 */
export const OG_CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800';

/** Wordmark view box is 3152 x 861 (3.66:1, `packages/brand/logo`); the box keeps that ratio. */
const WORDMARK_WIDTH = 234;
const WORDMARK_HEIGHT = 64;

/**
 * The paths are spelled out from `process.cwd()` (the web app directory that `next build` runs
 * in) so the file tracer includes these files only, not the whole project.
 */
async function fontFile(name: string): Promise<Buffer> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- names from OG_FONT_FILES
  return readFile(path.join(process.cwd(), 'assets', 'og-fonts', name));
}

/** {@link OG_WORDMARK_FILE}, spelled out for the tracer. */
async function wordmarkFile(): Promise<Buffer> {
  return readFile(
    path.join(process.cwd(), '..', '..', 'packages', 'brand', 'logo', 'kadro-wordmark-light.svg'),
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
    return 72;
  }
  return title.length <= 56 ? 60 : 50;
}

/** A 1200 x 630 PNG card: night-match background, pitch centre circle, wordmark and title. */
export async function renderOgImage(card: OgCard): Promise<ImageResponse> {
  const [display, body, bodyStrong, wordmark] = await Promise.all([
    fontFile(OG_FONT_FILES.display),
    fontFile(OG_FONT_FILES.body),
    fontFile(OG_FONT_FILES.bodyStrong),
    wordmarkFile(),
  ]);
  const wordmarkSrc = `data:image/svg+xml;base64,${wordmark.toString('base64')}`;
  const circle = 500;
  const centreX = OG_IMAGE_WIDTH - 130;
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px 72px',
        backgroundColor: OG_PALETTE.nightMatch,
        color: OG_PALETTE.chalkWhite,
        fontFamily: 'Inter',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: centreX - 12,
          top: 0,
          width: 24,
          height: OG_IMAGE_HEIGHT,
          backgroundColor: OG_PALETTE.pitchGreen,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: centreX - circle / 2,
          top: (OG_IMAGE_HEIGHT - circle) / 2,
          width: circle,
          height: circle,
          borderRadius: circle / 2,
          border: `24px solid ${OG_PALETTE.pitchGreen}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: 132,
            height: 132,
            borderRadius: 66,
            backgroundColor: OG_PALETTE.orangeBall,
          }}
        />
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- rendered to PNG by next/og, not HTML */}
      <img src={wordmarkSrc} width={WORDMARK_WIDTH} height={WORDMARK_HEIGHT} alt="Kadro" />
      <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 700 }}>
        {card.eyebrow === null ? null : (
          <div
            style={{
              fontSize: 30,
              fontWeight: 600,
              color: OG_PALETTE.orangeBall,
              marginBottom: 16,
            }}
          >
            {card.eyebrow}
          </div>
        )}
        <div
          style={{
            fontFamily: 'Sora',
            fontSize: titleSize(card.title),
            fontWeight: 700,
            lineHeight: 1.15,
          }}
        >
          {card.title}
        </div>
        <div
          style={{
            marginTop: 24,
            fontSize: 30,
            lineHeight: 1.35,
            color: OG_PALETTE.neutralOnDark,
          }}
        >
          {card.subtitle}
        </div>
      </div>
      <div style={{ display: 'flex', fontSize: 26, fontWeight: 600 }}>{SITE_TITLE}</div>
    </div>,
    {
      width: OG_IMAGE_WIDTH,
      height: OG_IMAGE_HEIGHT,
      headers: { 'Cache-Control': OG_CACHE_CONTROL },
      fonts: [
        { name: 'Sora', data: display, weight: 700, style: 'normal' },
        { name: 'Inter', data: body, weight: 400, style: 'normal' },
        { name: 'Inter', data: bodyStrong, weight: 600, style: 'normal' },
      ],
    },
  );
}
