'use client';

import { Button } from '../../components/marketing/button';
import { cx } from '../../components/marketing/class-names';
import { Container } from '../../components/marketing/section';
import { typeClassName } from '../../components/marketing/typography';
import styles from '../../components/seo/seo.module.css';

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
    <Container>
      <div className={styles.statusBlock}>
        <h1 className={cx(typeClassName('display'), styles.title)}>Bir şeyler ters gitti</h1>
        <p className={cx(typeClassName('lead'), styles.lead)}>
          Beklenmeyen bir hata oluştu. Lütfen biraz sonra tekrar dene.
        </p>
        {error.digest === undefined ? null : (
          <p className={styles.digest}>Referans: {error.digest}</p>
        )}
        <div className={styles.cta}>
          <Button
            variant="primary"
            onClick={() => {
              retry();
            }}
          >
            Tekrar dene
          </Button>
        </div>
      </div>
    </Container>
  );
}
