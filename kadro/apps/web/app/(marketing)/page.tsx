import type { Metadata } from 'next';
import { Fragment } from 'react';

import {
  CallsScreen,
  callsScreenLabel,
  MatchScreen,
  matchScreenLabel,
} from '../../components/marketing/app-screens';
import { ButtonLink } from '../../components/marketing/button';
import { cx } from '../../components/marketing/class-names';
import {
  DOWNLOAD_TEXT,
  HOME_AUDIENCES,
  HOME_FEATURE_ROWS,
  HOME_FEATURES_TITLE,
  HOME_HERO,
  HOME_INTRO,
  HOME_META,
  MATCH_WEEK,
  SAMPLE_MATCH,
  type HomeFeatureRow,
} from '../../components/marketing/content';
import { DeviceFrame } from '../../components/marketing/device-frame';
import { FactGrid } from '../../components/marketing/fact-grid';
import { pageMetadata } from '../../components/marketing/metadata';
import pages from '../../components/marketing/pages.module.css';
import { Section } from '../../components/marketing/section';
import { DOWNLOAD_ANCHOR } from '../../components/marketing/site';
import { LineupBoard, SquadSheet } from '../../components/marketing/squad-sheet';
import { StoreBadges } from '../../components/marketing/store-badges';
import { Timeline } from '../../components/marketing/timeline';
import { typeClassName } from '../../components/marketing/typography';
import { SiteJsonLd } from '../../components/seo/site-json-ld';

export const metadata: Metadata = pageMetadata({
  title: null,
  description: HOME_META.description,
  path: '/',
});

/** Device-framed screen of a feature row, in the order of {@link HOME_FEATURE_ROWS}. */
function rowScreen(row: HomeFeatureRow) {
  if (row.id === 'katilim') {
    return (
      <DeviceFrame label={matchScreenLabel()} caption="Maç ayrıntısı">
        <MatchScreen />
      </DeviceFrame>
    );
  }
  return (
    <DeviceFrame label={callsScreenLabel()} caption="Eksik Var ilanları">
      <CallsScreen />
    </DeviceFrame>
  );
}

function FeatureRowCopy({ row }: { readonly row: HomeFeatureRow }) {
  return (
    <>
      <h3 className={cx(typeClassName('title2'), pages.rowTitle)}>{row.title}</h3>
      <p className={pages.rowText}>{row.text}</p>
    </>
  );
}

/**
 * Home page of the marketing surface (direction §4.4): hero with the squad sheet, the match week
 * timeline, the feature rows, who it is for and the download band. The group layout renders it
 * per request (ADR-0055).
 */
export default function HomePage() {
  const [firstRow, secondRow, lineupRow] = HOME_FEATURE_ROWS;
  return (
    <>
      <SiteJsonLd />
      <Section density="hero" labelledBy="hero-baslik">
        <div className={pages.grid}>
          <div className={pages.heroCopy}>
            <h1 id="hero-baslik" className={cx(typeClassName('hero'), pages.heroTitle)}>
              {HOME_HERO.lines.map((line, index) => (
                <Fragment key={line}>
                  {index > 0 ? ' ' : null}
                  <span className={pages.heroLine}>{line}</span>
                </Fragment>
              ))}
            </h1>
            <p className={cx(typeClassName('lead'), pages.heroLead)}>{HOME_HERO.lead}</p>
            <div className={pages.actions}>
              <ButtonLink href={`#${DOWNLOAD_ANCHOR}`} variant="accent">
                Uygulamayı indir
              </ButtonLink>
              <ButtonLink href="/ozellikler" variant="text">
                Özellikleri gör
              </ButtonLink>
            </div>
          </div>
          <SquadSheet match={SAMPLE_MATCH} animated className={pages.heroSheet} />
        </div>
      </Section>

      <Section ruled labelledBy="mac-haftasi">
        <div className={pages.grid}>
          <div className={pages.weekIntro}>
            <h2 id="mac-haftasi" className={typeClassName('title1')}>
              Maç haftası Kadro’da böyle geçer
            </h2>
            <p className={pages.intro}>Örnek takımın Perşembe maçı, ilandan ücrete kadar.</p>
          </div>
          <Timeline items={MATCH_WEEK} className={pages.weekLog} />
        </div>
      </Section>

      <Section tone="surface" ruled labelledBy="one-cikanlar">
        <h2 id="one-cikanlar" className={cx(typeClassName('title1'), pages.sectionHead)}>
          {HOME_FEATURES_TITLE}
        </h2>
        <div className={pages.rows}>
          {[firstRow, secondRow].map((row) =>
            row === undefined ? null : (
              <div key={row.id} className={pages.row}>
                <div className={pages.rowMedia}>{rowScreen(row)}</div>
                <div className={pages.rowCopy}>
                  <FeatureRowCopy row={row} />
                  <FactGrid
                    items={row.facts.map((fact) => ({
                      term: fact.term,
                      figure: fact.figure,
                      empty: fact.empty,
                      text: fact.text,
                    }))}
                  />
                </div>
              </div>
            ),
          )}
          {lineupRow === undefined ? null : (
            <div className={pages.rowWide}>
              <div className={pages.rowWideHead}>
                <h3 className={cx(typeClassName('title2'), pages.rowTitle)}>{lineupRow.title}</h3>
                <p className={pages.rowText}>{lineupRow.text}</p>
              </div>
              <LineupBoard match={SAMPLE_MATCH} />
              <p>
                <ButtonLink href="/ozellikler" variant="text">
                  Tüm özellikleri incele
                </ButtonLink>
              </p>
            </div>
          )}
        </div>
      </Section>

      <Section ruled labelledBy="kimler-icin">
        <div className={pages.grid}>
          <h2 id="kimler-icin" className={cx(typeClassName('title1'), pages.whoTitle)}>
            Kim için
          </h2>
          <p className={cx(typeClassName('prose'), pages.whoDefinition)}>{HOME_INTRO}</p>
          <ul className={pages.whoList}>
            {HOME_AUDIENCES.map((item) => (
              <li key={item.title} className={pages.whoItem}>
                <h3 className={typeClassName('title3')}>{item.title}</h3>
                <p className={pages.whoText}>{item.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section id={DOWNLOAD_ANCHOR} tone="sunken" density="dense" labelledBy="indir-baslik">
        <div className={pages.download}>
          <div>
            <h2 id="indir-baslik" className={typeClassName('title1')}>
              Uygulamayı indir
            </h2>
            <p className={pages.downloadText}>{DOWNLOAD_TEXT}</p>
          </div>
          <StoreBadges />
        </div>
      </Section>
    </>
  );
}
