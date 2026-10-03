import { loadWebEnv } from '@kadro/config';
import type { Metadata } from 'next';
import Link from 'next/link';

import { BLOG_INTRO, BLOG_META } from '../../../components/content/copy';
import { ArticleDate, DocumentMeta } from '../../../components/content/parts';
import styles from '../../../components/content/prose.module.css';
import marketing from '../../../components/marketing/marketing.module.css';
import { pageMetadata } from '../../../components/marketing/metadata';
import { JsonLd } from '../../../components/seo/json-ld';
import { loadCollection } from '../../../lib/content/documents';
import { blogIndexStructuredData } from '../../../lib/server/seo/site-structured-data';

export const metadata: Metadata = pageMetadata({
  title: BLOG_META.title,
  description: BLOG_META.description,
  path: '/blog',
});

/** Blog index (product spec §7): every article, newest first, rendered per request (ADR-0055). */
export default function BlogIndexPage() {
  const articles = loadCollection('blog');
  return (
    <article>
      <JsonLd data={blogIndexStructuredData(loadWebEnv().WEB_ORIGIN, BLOG_META.description)} />
      <header className={marketing.sectionInner}>
        <div className={marketing.pageHeader}>
          <h1 className={marketing.pageTitle}>{BLOG_META.title}</h1>
          <p className={marketing.pageLead}>{BLOG_INTRO}</p>
        </div>
      </header>
      <div className={marketing.sectionInner}>
        <ul className={styles.articleList}>
          {articles.map((article) => (
            <li key={article.slug} className={styles.articleRow}>
              <ArticleDate date={article.publishedAt} />
              <div>
                <h2>
                  <Link href={`/blog/${article.slug}`}>{article.title}</Link>
                </h2>
                <p>{article.description}</p>
                <DocumentMeta document={article} showReadingTime />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
