import type { ContentDocument } from '../../lib/content/documents';
import marketing from '../marketing/marketing.module.css';
import { MarkdownView } from './markdown-view';
import { DocumentMeta, SampleNotice } from './parts';
import styles from './prose.module.css';

/**
 * Frame of a legal page: title, the visible sample notice (the texts are portfolio samples, see
 * `docs/legal/review-checklist.md`), publication dates and the rendered content (ADR-0080).
 */
export function LegalPage({ document }: { readonly document: ContentDocument }) {
  return (
    <article>
      <header className={marketing.sectionInner}>
        <div className={marketing.pageHeader}>
          <h1 className={marketing.pageTitle}>{document.title}</h1>
          <DocumentMeta document={document} showReadingTime={false} />
          <SampleNotice />
        </div>
      </header>
      <div className={`${marketing.sectionInner} ${styles.articleBody}`}>
        <MarkdownView blocks={document.blocks} />
      </div>
    </article>
  );
}
