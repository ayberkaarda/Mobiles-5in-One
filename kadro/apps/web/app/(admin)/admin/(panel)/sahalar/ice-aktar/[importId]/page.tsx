import { venueImportSchema } from '@kadro/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import styles from '../../../../../../../components/admin/admin.module.css';
import {
  Notice,
  PageHeading,
  readProblemMessage,
} from '../../../../../../../components/admin/frames';
import {
  formatDateTime,
  IMPORT_STATUS_LABELS,
  issueLabel,
} from '../../../../../../../components/admin/labels';
import { ADMIN_PATHS, importStatusPath } from '../../../../../../../components/admin/paths';
import { adminRead } from '../../../../../../../lib/admin/server-api';
import { followAuthRedirect } from '../../../../../../../lib/admin/session';
import { GET as readImportRoute } from '../../../../../../api/v1/admin/venues/import/[importId]/route';

export const metadata: Metadata = { title: 'İçe aktarma durumu' };

/** State, counters and row issues of one venue import (`GET admin/venues/import/:importId`). */
export default async function VenueImportStatusPage({
  params,
}: {
  readonly params: Promise<{ importId: string }>;
}) {
  const { importId } = await params;
  const self = importStatusPath(importId);
  if (self === null) {
    notFound();
  }
  const read = await adminRead(readImportRoute, venueImportSchema, {
    path: `/api/v1/admin/venues/import/${importId.toLowerCase()}`,
    params: { importId: importId.toLowerCase() },
  });
  followAuthRedirect(read);
  if (read.kind !== 'ok') {
    return (
      <>
        <PageHeading title="İçe aktarma durumu" />
        <Notice>{readProblemMessage(read.kind)}</Notice>
      </>
    );
  }
  const state = read.data;
  const running = state.status === 'queued' || state.status === 'processing';
  return (
    <>
      <PageHeading
        title="İçe aktarma durumu"
        lead={
          state.dryRun
            ? 'Deneme çalıştırması: satırlar yalnızca doğrulanır, saha eklenmez.'
            : undefined
        }
      />
      <section className={styles.section} aria-labelledby="import-state">
        <h2 id="import-state" className={styles.label}>
          Durum: <span data-testid="import-status">{IMPORT_STATUS_LABELS[state.status]}</span>
        </h2>
        <dl className={styles.stats}>
          <div className={styles.stat}>
            <dt>Toplam satır</dt>
            <dd>{state.totalRows ?? '—'}</dd>
          </div>
          <div className={styles.stat}>
            <dt>{state.dryRun ? 'Eklenebilir' : 'Eklenen'}</dt>
            <dd>{state.createdRows}</dd>
          </div>
          <div className={styles.stat}>
            <dt>Atlanan (zaten var)</dt>
            <dd>{state.skippedRows}</dd>
          </div>
          <div className={styles.stat}>
            <dt>Reddedilen</dt>
            <dd>{state.rejectedRows}</dd>
          </div>
        </dl>
        <p className={styles.hint}>
          Başlatıldı: <time dateTime={state.createdAt}>{formatDateTime(state.createdAt)}</time>
          {state.completedAt === null ? null : (
            <>
              {'. '}Bitti:{' '}
              <time dateTime={state.completedAt}>{formatDateTime(state.completedAt)}</time>
            </>
          )}
        </p>
        {running ? (
          <p>
            <Link className={styles.secondaryButton} href={self}>
              Durumu yenile
            </Link>
          </p>
        ) : null}
      </section>
      <section className={styles.section} aria-labelledby="import-issues">
        <h2 id="import-issues" className={styles.label}>
          Sorunlar
        </h2>
        {state.issues.length === 0 ? (
          <p className={styles.hint}>Bildirilen sorun yok.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Satır</th>
                  <th scope="col">Sütun</th>
                  <th scope="col">Sorun</th>
                </tr>
              </thead>
              <tbody>
                {state.issues.map((issue, index) => (
                  <tr key={`${issue.line}-${issue.column ?? ''}-${index}`}>
                    <td>{issue.line}</td>
                    <td>{issue.column === null ? '—' : <code>{issue.column}</code>}</td>
                    <td>{issueLabel(issue.issue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {state.rejectedRows > state.issues.length ? (
              <p className={styles.hint}>İlk 50 sorun gösteriliyor.</p>
            ) : null}
          </div>
        )}
      </section>
      <p>
        <Link className={styles.link} href={ADMIN_PATHS.venueImport}>
          Yeni içe aktarma
        </Link>
      </p>
    </>
  );
}
