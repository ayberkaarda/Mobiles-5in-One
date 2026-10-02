'use client';

import styles from '../../components/marketing/marketing.module.css';

/**
 * Error boundary of the marketing pages (security checklist item 13). It renders inside the
 * marketing shell, so header and footer navigation stay usable, and shows a fixed message and the
 * opaque error digest only; the error message and stack are never shown.
 */
export default function MarketingError({
  error,
  retry,
}: {
  readonly error: Error & { digest?: string };
  readonly retry: () => void;
}) {
  return (
    <div className={styles.statusBlock}>
      <h1 className={styles.pageTitle}>Bir şeyler ters gitti</h1>
      <p className={styles.pageLead}>
        Beklenmeyen bir hata oluştu. Lütfen biraz sonra tekrar dene.
      </p>
      {error.digest === undefined ? null : (
        <p className={styles.digest}>Referans: {error.digest}</p>
      )}
      <div className={styles.statusActions}>
        <button type="button" className={styles.buttonSolid} onClick={() => retry()}>
          Tekrar dene
        </button>
      </div>
    </div>
  );
}
