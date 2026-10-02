'use client';

import styles from '../../components/marketing/marketing.module.css';

/**
 * Error boundary of the SEO pages (security checklist item 13), for example while the database is
 * unreachable: a fixed message and the opaque error digest inside the shell, never the error
 * message or stack.
 */
export default function SeoError({
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
