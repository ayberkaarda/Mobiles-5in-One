import { loadWebEnv } from '@kadro/config';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import styles from '../../../../../components/marketing/marketing.module.css';
import { pageMetadata } from '../../../../../components/marketing/metadata';
import { DOWNLOAD_ANCHOR } from '../../../../../components/marketing/site';
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
      <header className={styles.sectionInner}>
        <div className={styles.pageHeader}>
          <nav aria-label="Konum">
            <ol className={styles.featureList}>
              <li>
                <Link href="/" className={styles.inlineLink}>
                  Ana sayfa
                </Link>
              </li>
              <li aria-current="page">{title}</li>
            </ol>
          </nav>
          <h1 className={styles.pageTitle}>{title}</h1>
          <p className={styles.pageLead}>{districtIntro(district)}</p>
        </div>
      </header>
      <section aria-labelledby="ilanlar" className={styles.sectionInner}>
        <h2 id="ilanlar" className={styles.sectionTitle}>
          Açık ilanlar
        </h2>
        {calls.length === 0 ? (
          <p className={styles.cardText}>
            Şu an {district.ilce} için açık eksik oyuncu ilanı yok. Yeni ilanları uygulamada anında
            görürsün.
          </p>
        ) : (
          <ul className={styles.cardGrid}>
            {calls.map((call) => (
              <li key={call.id} className={styles.card}>
                <h3 className={styles.cardTitle}>
                  {`${call.missingCount} eksik oyuncu · ${formatLabel(call.format)}`}
                </h3>
                <ul className={styles.featureList}>
                  <li>
                    Maç: <time dateTime={call.startsAt}>{formatMatchTime(call.startsAt)}</time>
                  </li>
                  <li>Mevki: {positionLabel(call.position)}</li>
                  <li>Seviye: {LEVEL_LABELS[call.level]}</li>
                  <li>Takım: {call.teamName}</li>
                  <li>
                    Saha:{' '}
                    {call.venue === null ? (
                      district.ilce
                    ) : (
                      <Link
                        href={venuePath(call.venue.slug) as Route}
                        className={styles.inlineLink}
                      >
                        {call.venue.name}
                      </Link>
                    )}
                  </li>
                  <li>
                    Son başvuru:{' '}
                    <time dateTime={call.expiresAt}>{formatMatchTime(call.expiresAt)}</time>
                  </li>
                </ul>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.statusActions}>
          <a href={`/#${DOWNLOAD_ANCHOR}`} className={styles.buttonSolid}>
            Başvurmak için uygulamayı indir
          </a>
        </div>
      </section>
      {venues.length === 0 ? null : (
        <section aria-labelledby="sahalar" className={styles.section}>
          <div className={styles.sectionInner}>
            <h2 id="sahalar" className={styles.sectionTitle}>
              {district.ilce} halı sahaları
            </h2>
            <ul className={styles.featureList}>
              {venues.map((venue) => (
                <li key={venue.slug}>
                  <Link href={venuePath(venue.slug) as Route} className={styles.inlineLink}>
                    {venue.name}
                  </Link>
                </li>
              ))}
            </ul>
            {venues.some((venue) => venue.isSample) ? (
              <p className={styles.notice}>[ÖRNEK] işaretli kayıtlar: {SAMPLE_NOTICE}</p>
            ) : null}
          </div>
        </section>
      )}
    </article>
  );
}
