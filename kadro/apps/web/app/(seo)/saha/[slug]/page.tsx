import { loadWebEnv } from '@kadro/config';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { pageMetadata } from '../../../../components/marketing/metadata';
import { ButtonLink } from '../../../../components/marketing/button';
import { cx } from '../../../../components/marketing/class-names';
import { KitNumeral } from '../../../../components/marketing/kit-numeral';
import { Section } from '../../../../components/marketing/section';
import { DOWNLOAD_ANCHOR } from '../../../../components/marketing/site';
import { typeClassName } from '../../../../components/marketing/typography';
import { Breadcrumb } from '../../../../components/seo/breadcrumb';
import styles from '../../../../components/seo/seo.module.css';
import {
  avatarInitial,
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
      <Section density="dense">
        <header className={styles.head}>
          <Breadcrumb current={venue.name} />
          <div className={styles.titleRow}>
            <h1 className={cx(typeClassName('display'), styles.title)}>{venue.name}</h1>
            {venue.isSample ? <span className={styles.tag}>{SAMPLE_NOTICE}</span> : null}
          </div>
          <p className={cx(typeClassName('lead'), styles.lead)}>
            {venueIntro({
              name: venue.name,
              il: district.il,
              ilce: district.ilce,
              indoor: venue.indoor,
            })}
          </p>
        </header>
      </Section>
      <Section labelledBy="saha-bilgi" density="dense" ruled>
        <h2 id="saha-bilgi" className={cx(typeClassName('title1'), styles.sectionTitle)}>
          Saha bilgileri
        </h2>
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>Konum</dt>
            <dd className={typeClassName('body')}>
              {district.ilce}, {district.il}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt>Tür</dt>
            <dd className={typeClassName('body')}>{venue.indoor ? 'Kapalı saha' : 'Açık saha'}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Fiyat aralığı</dt>
            <dd>
              {price === null ? (
                <span className={typeClassName('body')}>Belirtilmemiş</span>
              ) : (
                <KitNumeral value={price} />
              )}
            </dd>
          </div>
          {venue.address === null ? null : (
            <div className={styles.fact}>
              <dt>Adres</dt>
              <dd className={typeClassName('body')}>{venue.address}</dd>
            </div>
          )}
          {venue.phone === null ? null : (
            <div className={styles.fact}>
              <dt>Telefon</dt>
              <dd className={typeClassName('body')}>{venue.phone}</dd>
            </div>
          )}
        </dl>
      </Section>
      <Section labelledBy="saha-olanaklar" density="dense" ruled>
        <h2 id="saha-olanaklar" className={cx(typeClassName('title1'), styles.sectionTitle)}>
          Olanaklar
        </h2>
        {features.length === 0 ? (
          <p className={typeClassName('body')}>Olanak bilgisi girilmemiş.</p>
        ) : (
          <ul className={styles.chips}>
            {features.map((feature) => (
              <li
                key={feature.key}
                className={cx(styles.chip, feature.present ? undefined : styles.chipOff)}
              >
                <span aria-hidden="true" className={styles.chipMark}>
                  {feature.present ? '✓' : '✕'}
                </span>
                {`${feature.label}: ${feature.present ? 'Var' : 'Yok'}`}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section labelledBy="saha-yorumlar" density="dense" ruled>
        <h2 id="saha-yorumlar" className={cx(typeClassName('title1'), styles.sectionTitle)}>
          Oyuncu yorumları
        </h2>
        {venue.rating.average === null ? (
          <p className={typeClassName('body')}>
            {`${venue.rating.count} yorum. Ortalama puan en az üç yorumla gösterilir.`}
          </p>
        ) : (
          <div className={styles.ratingBlock}>
            <KitNumeral value={venue.rating.average.toLocaleString('tr-TR')} of={5} />
            <p className={cx(typeClassName('caption'), styles.rowCaption)}>
              {`Ortalama puan ${venue.rating.average.toLocaleString('tr-TR')} / 5 (${venue.rating.count} yorum).`}
            </p>
          </div>
        )}
        {venue.recentReviews.length === 0 ? null : (
          <ul className={styles.reviews}>
            {venue.recentReviews.map((review) => (
              <li key={review.id} className={styles.review}>
                <span className={styles.avatar} aria-hidden="true">
                  {avatarInitial(review.authorDisplayName)}
                </span>
                <div className={styles.reviewBody}>
                  <p className={cx(typeClassName('body'), styles.reviewHead)}>
                    <strong>{review.authorDisplayName}</strong> · {review.rating}/5 ·{' '}
                    {REVIEW_DATE.format(new Date(review.createdAt))}
                  </p>
                  {review.text === null ? null : (
                    <p className={cx(typeClassName('body'), styles.reviewText)}>{review.text}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section tone="sunken" density="dense">
        <h2 className={typeClassName('title1')}>Bu sahada maç kur</h2>
        <p className={cx(typeClassName('body'), styles.ctaText)}>
          Kadro uygulamasında takımını kur, maçı bu sahaya ekle, eksik oyuncuyu ilçeden bul.
        </p>
        <div className={styles.cta}>
          <ButtonLink href={`/#${DOWNLOAD_ANCHOR}`} variant="accent">
            Bu sahada maç kur
          </ButtonLink>
          <Link
            href={districtPath(district.ilSlug, district.slug) as Route}
            className={styles.textLink}
          >
            {district.ilce} eksik oyuncu ilanları
          </Link>
        </div>
      </Section>
    </article>
  );
}
