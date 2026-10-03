import { loadWebEnv } from '@kadro/config';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { MarkdownView } from '../../../../components/content/markdown-view';
import { DocumentMeta } from '../../../../components/content/parts';
import styles from '../../../../components/content/prose.module.css';
import marketing from '../../../../components/marketing/marketing.module.css';
import { pageMetadata } from '../../../../components/marketing/metadata';
import { articleOgImage } from '../../../../components/marketing/og';
import { JsonLd } from '../../../../components/seo/json-ld';
import { findDocument, loadCollection } from '../../../../lib/content/documents';
import { articleStructuredData } from '../../../../lib/server/seo/site-structured-data';

interface ArticlePageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

const RELATED_COUNT = 3;

export async function generateMetadata({ params }: ArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = findDocument('blog', slug);
  if (article === undefined) {
    return { title: 'Yazı bulunamadı', robots: { index: false, follow: false } };
  }
  const metadata = pageMetadata({
    title: article.title,
    description: article.description,
    path: `/blog/${article.slug}`,
    image: articleOgImage(article.slug, article.title),
  });
  return {
    ...metadata,
    openGraph: {
      ...metadata.openGraph,
      type: 'article',
      publishedTime: article.publishedAt,
      modifiedTime: article.modifiedAt,
    },
    ...(article.tags.length > 0 ? { keywords: [...article.tags] } : {}),
  };
}

/**
 * Blog article (product spec §7 `/blog/[slug]`). The slug is only looked up in the loaded
 * content list; an unknown slug is a 404 through the root not-found page (ADR-0080).
 */
export default async function ArticlePage({ params }: ArticlePageProps) {
  const { slug } = await params;
  const article = findDocument('blog', slug);
  if (article === undefined) {
    notFound();
  }
  const path = `/blog/${article.slug}`;
  const related = loadCollection('blog')
    .filter((other) => other.slug !== article.slug)
    .slice(0, RELATED_COUNT);
  return (
    <article>
      <JsonLd
        data={articleStructuredData(
          loadWebEnv().WEB_ORIGIN,
          article,
          path,
          articleOgImage(article.slug, article.title).path,
        )}
      />
      <header className={marketing.sectionInner}>
        <div className={marketing.pageHeader}>
          <nav aria-label="Konum">
            <ol className={styles.crumbs}>
              <li>
                <Link href="/" className={styles.link}>
                  Ana sayfa
                </Link>
              </li>
              <li>
                <Link href="/blog" className={styles.link}>
                  Blog
                </Link>
              </li>
            </ol>
          </nav>
          <h1 className={marketing.pageTitle}>{article.title}</h1>
          <DocumentMeta document={article} showReadingTime />
        </div>
      </header>
      <div className={`${marketing.sectionInner} ${styles.articleBody}`}>
        <MarkdownView blocks={article.blocks} />
        <p className={marketing.notice}>
          Kadro ile maçını kur, eksik oyuncuyu bul ve ücreti takip et.{' '}
          <Link href="/ozellikler" className={styles.link}>
            Özellikleri incele
          </Link>
          .
        </p>
        {related.length > 0 ? (
          <aside className={styles.related} aria-labelledby="ilgili-yazilar">
            <h2 id="ilgili-yazilar">Diğer yazılar</h2>
            <ul>
              {related.map((other) => (
                <li key={other.slug}>
                  <Link href={`/blog/${other.slug}`} className={styles.link}>
                    {other.title}
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </div>
    </article>
  );
}
