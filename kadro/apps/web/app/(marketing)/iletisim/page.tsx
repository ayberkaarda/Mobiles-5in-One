import type { Metadata } from 'next';
import Link from 'next/link';

import { CONTACT_INTRO, CONTACT_META, CONTACT_NOTE } from '../../../components/content/copy';
import { SampleNotice } from '../../../components/content/parts';
import styles from '../../../components/content/prose.module.css';
import marketing from '../../../components/marketing/marketing.module.css';
import { pageMetadata } from '../../../components/marketing/metadata';

export const metadata: Metadata = pageMetadata({
  title: CONTACT_META.title,
  description: CONTACT_META.description,
  path: '/iletisim',
});

/**
 * Contact page (product spec §7 `/iletisim`). No contact channel or controller exists for a
 * portfolio project, so the page says so and links the pages that exist instead of inventing
 * an address (ADR-0080).
 */
export default function ContactPage() {
  return (
    <article>
      <header className={marketing.sectionInner}>
        <div className={marketing.pageHeader}>
          <h1 className={marketing.pageTitle}>{CONTACT_META.title}</h1>
          <p className={marketing.pageLead}>{CONTACT_INTRO}</p>
          <SampleNotice />
        </div>
      </header>
      <div className={`${marketing.sectionInner} ${styles.articleBody}`}>
        <div className={styles.prose}>
          <h2>İlgili sayfalar</h2>
          <ul>
            <li>
              <Link href="/hesap-silme" className={styles.link}>
                Hesabımı sil
              </Link>
            </li>
            <li>
              <Link href="/gizlilik" className={styles.link}>
                Gizlilik: teknik işleme örneği
              </Link>
            </li>
            <li>
              <Link href="/kvkk-aydinlatma" className={styles.link}>
                KVKK aydınlatma: örnek metin
              </Link>
            </li>
          </ul>
          <p>{CONTACT_NOTE}</p>
        </div>
      </div>
    </article>
  );
}
