import { loadWebEnv } from '@kadro/config';
import type { Metadata } from 'next';
import Link from 'next/link';

import {
  FAQ_ENTRIES,
  FAQ_INTRO,
  FAQ_META,
  FAQ_NOTE_TEXT,
  FAQ_NOTE_TITLE,
} from '../../../components/content/faq';
import styles from '../../../components/content/prose.module.css';
import marketing from '../../../components/marketing/marketing.module.css';
import { pageMetadata } from '../../../components/marketing/metadata';
import { JsonLd } from '../../../components/seo/json-ld';
import { faqStructuredData } from '../../../lib/server/seo/site-structured-data';

const PATH = '/sss';

export const metadata: Metadata = pageMetadata({
  title: FAQ_META.title,
  description: FAQ_META.description,
  path: PATH,
});

/**
 * FAQ page (product spec §7 `/sss`, ADR-0083). The questions and answers are rendered as text and
 * mirrored one to one in the `FAQPage` data block; a visible note says what is a sample.
 */
export default function FaqPage() {
  return (
    <article>
      <JsonLd
        data={faqStructuredData(loadWebEnv().WEB_ORIGIN, PATH, FAQ_META.title, FAQ_ENTRIES)}
      />
      <header className={marketing.sectionInner}>
        <div className={marketing.pageHeader}>
          <h1 className={marketing.pageTitle}>{FAQ_META.title}</h1>
          <p className={marketing.pageLead}>{FAQ_INTRO}</p>
          <aside className={styles.sampleNotice} role="note" aria-label={FAQ_NOTE_TITLE}>
            <strong>{FAQ_NOTE_TITLE}</strong>
            {FAQ_NOTE_TEXT}
          </aside>
        </div>
      </header>
      <div className={`${marketing.sectionInner} ${styles.articleBody}`}>
        <div className={styles.faqLayout}>
          <nav className={styles.faqIndexWrap} aria-label="Sorular">
            <p className={styles.faqIndexTitle}>Sorular</p>
            <ul className={styles.faqIndex}>
              {FAQ_ENTRIES.map((entry) => (
                <li key={entry.id}>
                  <a href={`#${entry.id}`}>{entry.question}</a>
                </li>
              ))}
            </ul>
          </nav>
          <div className={styles.prose}>
            {FAQ_ENTRIES.map((entry) => (
              <section key={entry.id} aria-labelledby={entry.id}>
                <h2 id={entry.id}>{entry.question}</h2>
                <p>{entry.answer}</p>
              </section>
            ))}
            <h2 id="ilgili-sayfalar">İlgili sayfalar</h2>
            <ul>
              <li>
                <Link href="/ozellikler" className={styles.link}>
                  Özellikler
                </Link>
              </li>
              <li>
                <Link href="/blog" className={styles.link}>
                  Blog
                </Link>
              </li>
              <li>
                <Link href="/hesap-silme" className={styles.link}>
                  Hesabımı sil
                </Link>
              </li>
              <li>
                <Link href="/gizlilik" className={styles.link}>
                  Gizlilik (örnek)
                </Link>
              </li>
              <li>
                <Link href="/kvkk-aydinlatma" className={styles.link}>
                  KVKK aydınlatma (örnek)
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </article>
  );
}
