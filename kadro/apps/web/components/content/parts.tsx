import type { ContentDocument } from '../../lib/content/documents';
import { SAMPLE_NOTICE_TEXT, SAMPLE_NOTICE_TITLE } from './copy';
import styles from './prose.module.css';

const DATE_FORMAT = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** "2 Ekim 2026" from a `YYYY-MM-DD` content date (a calendar date, not an instant). */
export function formatContentDate(date: string): string {
  return DATE_FORMAT.format(new Date(`${date}T00:00:00Z`));
}

/** Visible notice of a sample text: the page is part of a portfolio project (review checklist). */
export function SampleNotice() {
  return (
    <aside className={styles.sampleNotice} role="note" aria-label={SAMPLE_NOTICE_TITLE}>
      <strong>{SAMPLE_NOTICE_TITLE}</strong>
      {SAMPLE_NOTICE_TEXT}
    </aside>
  );
}

/** Publication date, last change (when different) and reading time of a document. */
export function DocumentMeta({
  document,
  showReadingTime,
}: {
  readonly document: ContentDocument;
  readonly showReadingTime: boolean;
}) {
  return (
    <ul className={styles.meta}>
      <li>
        Yayın:{' '}
        <time dateTime={document.publishedAt}>{formatContentDate(document.publishedAt)}</time>
      </li>
      {document.modifiedAt !== document.publishedAt ? (
        <li>
          Güncelleme:{' '}
          <time dateTime={document.modifiedAt}>{formatContentDate(document.modifiedAt)}</time>
        </li>
      ) : null}
      {showReadingTime ? <li>{`${document.readingMinutes} dk okuma`}</li> : null}
    </ul>
  );
}
