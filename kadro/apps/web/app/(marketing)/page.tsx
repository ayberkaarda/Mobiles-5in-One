import type { Metadata } from 'next';
import Link from 'next/link';

import {
  DOWNLOAD_TEXT,
  HOME_AUDIENCES,
  HOME_HIGHLIGHTS,
  HOME_INTRO,
  HOME_META,
  HOME_STEPS,
} from '../../components/marketing/content';
import styles from '../../components/marketing/marketing.module.css';
import { pageMetadata } from '../../components/marketing/metadata';
import { DOWNLOAD_ANCHOR, SITE_TAGLINE } from '../../components/marketing/site';
import { StoreBadges } from '../../components/marketing/store-badges';
import { SiteJsonLd } from '../../components/seo/site-json-ld';

export const metadata: Metadata = pageMetadata({
  title: null,
  description: HOME_META.description,
  path: '/',
});

/** Home page of the marketing surface; the group layout renders it per request (ADR-0055). */
export default function HomePage() {
  return (
    <>
      <SiteJsonLd />
      <section className={styles.hero} aria-labelledby="hero-baslik">
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Halı saha &amp; eksik oyuncu</p>
          <h1 id="hero-baslik" className={styles.heroTitle}>
            {SITE_TAGLINE}
          </h1>
          <p className={styles.heroLead}>{HOME_INTRO}</p>
          <div className={styles.heroActions}>
            <a href={`#${DOWNLOAD_ANCHOR}`} className={styles.buttonPrimary}>
              Uygulamayı indir
            </a>
            <Link href="/ozellikler" className={styles.buttonSecondary}>
              Özellikleri gör
            </Link>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="nasil-calisir">
        <div className={styles.sectionInner}>
          <h2 id="nasil-calisir" className={styles.sectionTitle}>
            Nasıl çalışır?
          </h2>
          <p className={styles.sectionLead}>Üç adımda maçın hazır.</p>
          <ol className={styles.steps}>
            {HOME_STEPS.map((step) => (
              <li key={step.title} className={styles.step}>
                <h3 className={styles.cardTitle}>{step.title}</h3>
                <p className={styles.cardText}>{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionAlt}`} aria-labelledby="one-cikanlar">
        <div className={styles.sectionInner}>
          <h2 id="one-cikanlar" className={styles.sectionTitle}>
            Maç gününe kadar her şey
          </h2>
          <ul className={styles.cardGrid}>
            {HOME_HIGHLIGHTS.map((item) => (
              <li key={item.title} className={styles.card}>
                <h3 className={styles.cardTitle}>{item.title}</h3>
                <p className={styles.cardText}>{item.text}</p>
              </li>
            ))}
          </ul>
          <p className={styles.sectionLead}>
            <Link href="/ozellikler" className={styles.inlineLink}>
              Tüm özellikleri incele
            </Link>
          </p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="kimler-icin">
        <div className={styles.sectionInner}>
          <h2 id="kimler-icin" className={styles.sectionTitle}>
            Kimler için?
          </h2>
          <ul className={styles.cardGrid}>
            {HOME_AUDIENCES.map((item) => (
              <li key={item.title} className={styles.card}>
                <h3 className={styles.cardTitle}>{item.title}</h3>
                <p className={styles.cardText}>{item.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        id={DOWNLOAD_ANCHOR}
        className={`${styles.section} ${styles.sectionAlt}`}
        aria-labelledby="indir-baslik"
      >
        <div className={`${styles.sectionInner} ${styles.download}`}>
          <div>
            <h2 id="indir-baslik" className={styles.sectionTitle}>
              Uygulamayı indir
            </h2>
            <p className={styles.sectionLead}>{DOWNLOAD_TEXT}</p>
          </div>
          <StoreBadges />
        </div>
      </section>
    </>
  );
}
