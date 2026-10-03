import { loadWebEnv } from '@kadro/config';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EksikSlot } from '../../../../../components/marketing/eksik-slot';
import { pageMetadata } from '../../../../../components/marketing/metadata';
import { ButtonLink } from '../../../../../components/marketing/button';
import { Section } from '../../../../../components/marketing/section';
import { DOWNLOAD_ANCHOR } from '../../../../../components/marketing/site';
import { typeClassName } from '../../../../../components/marketing/typography';
import { cx } from '../../../../../components/marketing/class-names';
import {
  districtDescription,
  districtIntro,
  districtPath,
  districtTitle,
  formatLabel,
  formatMatchTime,
  LEVEL_LABELS,
  positionLabel,
  SAMPLE_NOTICE,
  venuePath,
} from '../../../../../components/seo/format';
import { Breadcrumb } from '../../../../../components/seo/breadcrumb';
import styles from '../../../../../components/seo/seo.module.css';
import { JsonLd } from '../../../../../components/seo/json-ld';
import { districtStructuredData } from '../../../../../lib/server/seo/structured-data';
import { districtListing } from '../../../../../lib/server/seo/data';

interface DistrictPageProps {
  readonly params: Promise<{ readonly il: string; readonly ilce: string }>;
}

/**
 * District metadata: canonical `/eksik-var/[il]/[ilce]`. A district without a live call is a thin
 * page and carries `noindex` until a call is published (ADR-0057).
 */
export async function generateMetadata({ params }: DistrictPageProps): Promise<Metadata> {
  const { il, ilce } = await params;
  const listing = await districtListing(il, ilce);
  if (listing === null) {
    return { title: 'Sayfa bulunamadı', robots: { index: false, follow: false } };
  }
  const { district } = listing;
  const metadata = pageMetadata({
    title: districtTitle(district),
    description: districtDescription(district, listing.calls.length),
    path: districtPath(district.ilSlug, district.slug),
  });
  return listing.calls.length === 0
    ? { ...metadata, robots: { index: false, follow: true } }
    : metadata;
}

/**
 * Public open calls of one district (product spec §7 `/eksik-var/[il]/[ilce]`): the projection of
 * `GET open-calls` (authorization matrix footnote 18), expired calls removed at every read.
 */
export default async function DistrictCallsPage({ params }: DistrictPageProps) {
  const { il, ilce } = await params;
  const listing = await districtListing(il, ilce);
  if (listing === null) {
    notFound();
  }
  const { district, calls, venues } = listing;
  const path = districtPath(district.ilSlug, district.slug);
  const title = districtTitle(district);
  return (
    <article>
      <JsonLd data={districtStructuredData(loadWebEnv().WEB_ORIGIN, path, title)} />
      <Section density="dense">
        <header className={styles.head}>
          <Breadcrumb current={title} />
          <h1 className={cx(typeClassName('display'), styles.title)}>{title}</h1>
          <p className={cx(typeClassName('lead'), styles.lead)}>{districtIntro(district)}</p>
        </header>
      </Section>
      <Section labelledBy="ilanlar" density="dense" ruled>
        <h2 id="ilanlar" className={cx(typeClassName('title1'), styles.sectionTitle)}>
          Açık ilanlar
        </h2>
        {calls.length === 0 ? (
          <p className={cx(typeClassName('body'), styles.empty)}>
            <EksikSlot size={48} />
            <span>
              Şu an {district.ilce} için açık eksik oyuncu ilanı yok. Yeni ilanları uygulamada
              anında görürsün.
            </span>
          </p>
        ) : (
          <ul className={styles.rows}>
            {calls.map((call) => (
              <li key={call.id} className={styles.row}>
                <EksikSlot
                  number={call.missingCount}
                  label="EKSİK"
                  title={`${call.missingCount} eksik oyuncu`}
                  size={64}
                />
                <div className={styles.rowMain}>
                  <h3 className={cx(typeClassName('title3'), styles.rowTitle)}>
                    {`${call.missingCount} eksik oyuncu · ${formatLabel(call.format)}`}
                  </h3>
                  <p className={cx(typeClassName('body'), styles.rowMeta)}>
                    <time dateTime={call.startsAt}>{formatMatchTime(call.startsAt)}</time>
                  </p>
                  <p className={cx(typeClassName('body'), styles.rowMeta)}>
                    Takım: {call.teamName}
                  </p>
                  <p className={cx(typeClassName('body'), styles.rowMeta)}>
                    Saha:{' '}
                    {call.venue === null ? (
                      district.ilce
                    ) : (
                      <Link href={venuePath(call.venue.slug) as Route} className={styles.rowLink}>
                        {call.venue.name}
                      </Link>
                    )}
                  </p>
                </div>
                <div className={styles.rowSide}>
                  <ul className={styles.chips}>
                    <li className={styles.chip}>{`Mevki: ${positionLabel(call.position)}`}</li>
                    <li className={styles.chip}>{`Seviye: ${LEVEL_LABELS[call.level]}`}</li>
                  </ul>
                  <p className={styles.rowCaption}>
                    Son başvuru:{' '}
                    <time dateTime={call.expiresAt}>{formatMatchTime(call.expiresAt)}</time>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.cta}>
          <ButtonLink href={`/#${DOWNLOAD_ANCHOR}`} variant="accent">
            Başvurmak için uygulamayı indir
          </ButtonLink>
        </div>
      </Section>
      {venues.length === 0 ? null : (
        <Section labelledBy="sahalar" density="dense" ruled>
          <h2 id="sahalar" className={cx(typeClassName('title1'), styles.sectionTitle)}>
            {district.ilce} halı sahaları
          </h2>
          <ul className={styles.links}>
            {venues.map((venue) => (
              <li key={venue.slug}>
                <Link href={venuePath(venue.slug) as Route}>{venue.name}</Link>
              </li>
            ))}
          </ul>
          {venues.some((venue) => venue.isSample) ? (
            <p className={styles.notice}>[ÖRNEK] işaretli kayıtlar: {SAMPLE_NOTICE}</p>
          ) : null}
        </Section>
      )}
    </article>
  );
}
