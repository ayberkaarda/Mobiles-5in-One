import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import {
  FeeScreen,
  feeScreenLabel,
  MatchScreen,
  matchScreenLabel,
  TeamScreen,
  teamScreenLabel,
} from '../../../components/marketing/app-screens';
import { ButtonLink } from '../../../components/marketing/button';
import { cx } from '../../../components/marketing/class-names';
import {
  FEATURE_CLOSING_IDS,
  FEATURE_GROUPS,
  FEATURE_SECTIONS,
  FEATURES_INTRO,
  FEATURES_META,
  PRO_PRICE_NOTE,
  SAMPLE_MATCH,
  type FeatureGroup,
  type FeatureSection,
} from '../../../components/marketing/content';
import { DeviceFrame } from '../../../components/marketing/device-frame';
import { FactGrid } from '../../../components/marketing/fact-grid';
import { pageMetadata } from '../../../components/marketing/metadata';
import pages from '../../../components/marketing/pages.module.css';
import { Section } from '../../../components/marketing/section';
import { DOWNLOAD_ANCHOR } from '../../../components/marketing/site';
import { LineupBoard } from '../../../components/marketing/squad-sheet';
import { typeClassName } from '../../../components/marketing/typography';
import { SiteJsonLd } from '../../../components/seo/site-json-ld';

export const metadata: Metadata = pageMetadata({
  title: FEATURES_META.title,
  description: FEATURES_META.description,
  path: '/ozellikler',
});

function sectionsOf(ids: readonly string[]): readonly FeatureSection[] {
  return ids.flatMap((id) => FEATURE_SECTIONS.filter((section) => section.id === id));
}

/** The device-framed screen of a group; the Eksik Var group shows the lineup instead. */
function groupScreen(group: FeatureGroup): ReactNode {
  switch (group.id) {
    case 'grup-takim':
      return (
        <DeviceFrame label={teamScreenLabel()} caption="Takım">
          <TeamScreen />
        </DeviceFrame>
      );
    case 'grup-mac':
      return (
        <DeviceFrame label={matchScreenLabel()} caption="Maç ayrıntısı">
          <MatchScreen />
        </DeviceFrame>
      );
    case 'grup-saha':
      return (
        <DeviceFrame label={feeScreenLabel()} caption="Saha ücreti">
          <FeeScreen />
        </DeviceFrame>
      );
    default:
      return null;
  }
}

function GroupFacts({ group }: { readonly group: FeatureGroup }) {
  return (
    <FactGrid
      items={sectionsOf(group.sectionIds).map((section) => ({
        id: section.id,
        term: section.title,
        text: section.text,
        details: section.points,
      }))}
    />
  );
}

/**
 * Feature overview (product spec §7 `/ozellikler`, direction §4.4): four groups as rows of a
 * device-framed screen and a definition list (rows 1 and 2 screen left, row 3 the full-width
 * lineup, row 4 screen right), then Kadro Pro and Hesap as two columns of text. Content follows
 * the MVP scope of spec §3; every feature keeps its anchor id.
 */
export default function FeaturesPage() {
  return (
    <article>
      <SiteJsonLd />
      <Section density="dense" labelledBy="ozellikler-baslik">
        <h1 id="ozellikler-baslik" className={typeClassName('display')}>
          {FEATURES_META.title}
        </h1>
        <p className={cx(typeClassName('lead'), pages.pageLead)}>{FEATURES_INTRO}</p>
      </Section>

      {FEATURE_GROUPS.map((group, index) => {
        const headingId = `${group.id}-baslik`;
        const title = (
          <h2 id={headingId} className={cx(typeClassName('title1'), pages.groupTitle)}>
            {group.title}
          </h2>
        );
        if (group.id === 'grup-eksik-var') {
          return (
            <Section key={group.id} id={group.id} ruled tone="surface" labelledBy={headingId}>
              <div className={pages.rowWideHead}>
                {title}
                <GroupFacts group={group} />
              </div>
              <LineupBoard match={SAMPLE_MATCH} />
            </Section>
          );
        }
        return (
          <Section key={group.id} id={group.id} ruled labelledBy={headingId}>
            <div className={cx(pages.row, index === FEATURE_GROUPS.length - 1 && pages.rowReverse)}>
              <div className={pages.rowMedia}>{groupScreen(group)}</div>
              <div className={pages.rowCopy}>
                {title}
                <GroupFacts group={group} />
              </div>
            </div>
          </Section>
        );
      })}

      <Section ruled>
        <div className={pages.closing}>
          {sectionsOf(FEATURE_CLOSING_IDS).map((section) => (
            <section key={section.id} id={section.id} aria-labelledby={`${section.id}-baslik`}>
              <h2 id={`${section.id}-baslik`} className={typeClassName('title2')}>
                {section.title}
              </h2>
              <p className={pages.closingText}>{section.text}</p>
              <ul className={pages.closingList}>
                {section.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              {section.id === 'kadro-pro' ? <p className={pages.note}>{PRO_PRICE_NOTE}</p> : null}
            </section>
          ))}
        </div>
        <div className={pages.cta}>
          <ButtonLink href={`/#${DOWNLOAD_ANCHOR}`}>Uygulamayı indir</ButtonLink>
        </div>
      </Section>
    </article>
  );
}
