import type { Metadata } from 'next';

import {
  FEATURE_SECTIONS,
  FEATURES_INTRO,
  FEATURES_META,
  PRO_PRICE_NOTE,
} from '../../../components/marketing/content';
import styles from '../../../components/marketing/marketing.module.css';
import { pageMetadata } from '../../../components/marketing/metadata';
import { DOWNLOAD_ANCHOR } from '../../../components/marketing/site';
import { SiteJsonLd } from '../../../components/seo/site-json-ld';

export const metadata: Metadata = pageMetadata({
  title: FEATURES_META.title,
  description: FEATURES_META.description,
  path: '/ozellikler',
});

/** Feature overview (product spec §7 `/ozellikler`); content follows the MVP scope of §3. */
export default function FeaturesPage() {
  return (
    <article>
      <SiteJsonLd />
      <header className={styles.sectionInner}>
        <div className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>{FEATURES_META.title}</h1>
          <p className={styles.pageLead}>{FEATURES_INTRO}</p>
        </div>
      </header>
      <div className={styles.sectionInner}>
        <ul className={styles.cardGrid}>
          {FEATURE_SECTIONS.map((section) => (
            <li key={section.id} className={styles.card}>
              <section id={section.id} aria-labelledby={`${section.id}-baslik`}>
                <h2 id={`${section.id}-baslik`} className={styles.cardTitle}>
                  {section.title}
                </h2>
                <p className={styles.cardText}>{section.text}</p>
                <ul className={styles.featureList}>
                  {section.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </section>
            </li>
          ))}
        </ul>
        <p className={styles.notice}>{PRO_PRICE_NOTE}</p>
      </div>
      <div className={styles.section}>
        <div className={styles.sectionInner}>
          <a href={`/#${DOWNLOAD_ANCHOR}`} className={styles.buttonSolid}>
            Uygulamayı indir
          </a>
        </div>
      </div>
    </article>
  );
}
