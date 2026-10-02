import { loadWebEnv } from '@kadro/config';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import styles from '../../../../components/marketing/marketing.module.css';
import { pageMetadata } from '../../../../components/marketing/metadata';
import { DOWNLOAD_ANCHOR } from '../../../../components/marketing/site';
import {
  districtPath,
  featureRows,
  formatPriceRange,
  SAMPLE_NOTICE,
  venueDescription,
  venueIntro,
  venuePath,
  venueTitle,
} from '../../../../components/seo/format';
import { JsonLd } from '../../../../components/seo/json-ld';
import { venueStructuredData } from '../../../../lib/server/seo/structured-data';
import { publicVenue } from '../../../../lib/server/seo/data';

interface VenuePageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

const REVIEW_DATE = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/**
 * Venue metadata: canonical `/saha/[slug]`, title and description within the spec §7 limits.
 * Sample venues are demonstration data and carry `noindex` (ADR-0057).
 */
export async function generateMetadata({ params }: VenuePageProps): Promise<Metadata> {
  const { slug } = await params;
  const venue = await publicVenue(slug);
  if (venue === null) {
    return { title: 'Saha bulunamadı', robots: { index: false, follow: false } };
  }
  const facts = { name: venue.name, il: venue.district.il, ilce: venue.district.ilce };
  const metadata = pageMetadata({
    title: venueTitle(venue.name),
    description: venueDescription(
      { ...facts, indoor: venue.indoor },
      formatPriceRange(venue.priceMinMinor, venue.priceMaxMinor),
    ),
    path: venuePath(venue.slug),
  });
  return venue.isSample ? { ...metadata, robots: { index: false, follow: true } } : metadata;
}

/** Venue page (product spec §7 `/saha/[slug]`): place, features, price range, reviews, CTA. */
export default async function VenuePage({ params }: VenuePageProps) {
  const { slug } = await params;
  const venue = await publicVenue(slug);
  if (venue === null) {
    notFound();
  }
  const path = venuePath(venue.slug);
  const price = formatPriceRange(venue.priceMinMinor, venue.priceMaxMinor);
  const features = featureRows(venue.features);
  const { district } = venue;
  return (
    <article>
      <JsonLd data={venueStructuredData(loadWebEnv().WEB_ORIGIN, venue, path)} />
      <header className={styles.sectionInner}>
        <div className={styles.pageHeader}>
          <nav aria-label="Konum">
            <ol className={styles.featureList}>
              <li>
                <Link href="/" className={styles.inlineLink}>
                  Ana sayfa
                </Link>
              </li>
              <li aria-current="page">{venue.name}</li>
            </ol>
          </nav>
          <h1 className={styles.pageTitle}>{venue.name}</h1>
          <p className={styles.pageLead}>
            {venueIntro({
              name: venue.name,
              il: district.il,
              ilce: district.ilce,
              indoor: venue.indoor,
            })}
          </p>
          {venue.isSample ? <p className={styles.notice}>{SAMPLE_NOTICE}</p> : null}
        </div>
      </header>
      <div className={styles.sectionInner}>
        <ul className={styles.cardGrid}>
          <li className={styles.card}>
            <section aria-labelledby="saha-bilgi">
              <h2 id="saha-bilgi" className={styles.cardTitle}>
                Saha bilgileri
              </h2>
              <ul className={styles.featureList}>
                <li>
                  Konum: {district.ilce}, {district.il}
                </li>
                <li>Tür: {venue.indoor ? 'Kapalı saha' : 'Açık saha'}</li>
                <li>Fiyat aralığı: {price ?? 'Belirtilmemiş'}</li>
                {venue.address === null ? null : <li>Adres: {venue.address}</li>}
                {venue.phone === null ? null : <li>Telefon: {venue.phone}</li>}
              </ul>
            </section>
          </li>
          <li className={styles.card}>
            <section aria-labelledby="saha-olanaklar">
              <h2 id="saha-olanaklar" className={styles.cardTitle}>
                Olanaklar
              </h2>
              {features.length === 0 ? (
                <p className={styles.cardText}>Olanak bilgisi girilmemiş.</p>
              ) : (
                <ul className={styles.featureList}>
                  {features.map((feature) => (
                    <li key={feature.key}>
                      {feature.label}: {feature.present ? 'Var' : 'Yok'}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </li>
          <li className={styles.card}>
            <section aria-labelledby="saha-yorumlar">
              <h2 id="saha-yorumlar" className={styles.cardTitle}>
                Oyuncu yorumları
              </h2>
              <p className={styles.cardText}>
                {venue.rating.average === null
                  ? `${venue.rating.count} yorum. Ortalama puan en az üç yorumla gösterilir.`
                  : `Ortalama puan ${venue.rating.average.toLocaleString('tr-TR')} / 5 (${venue.rating.count} yorum).`}
              </p>
              {venue.recentReviews.length === 0 ? null : (
                <ul className={styles.featureList}>
                  {venue.recentReviews.map((review) => (
                    <li key={review.id}>
                      <strong>{review.authorDisplayName}</strong> · {review.rating}/5 ·{' '}
                      {REVIEW_DATE.format(new Date(review.createdAt))}
                      {review.text === null ? null : <> · {review.text}</>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </li>
        </ul>
      </div>
      <div className={styles.section}>
        <div className={styles.sectionInner}>
          <h2 className={styles.sectionTitle}>Bu sahada maç kur</h2>
          <p className={styles.cardText}>
            Kadro uygulamasında takımını kur, maçı bu sahaya ekle, eksik oyuncuyu ilçeden bul.
          </p>
          <div className={styles.statusActions}>
            <a href={`/#${DOWNLOAD_ANCHOR}`} className={styles.buttonSolid}>
              Bu sahada maç kur
            </a>
            <Link
              href={districtPath(district.ilSlug, district.slug) as Route}
              className={styles.inlineLink}
            >
              {district.ilce} eksik oyuncu ilanları
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
