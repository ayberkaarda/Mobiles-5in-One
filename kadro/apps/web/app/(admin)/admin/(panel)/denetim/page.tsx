import { auditLogEntrySchema, paginatedResponseSchema } from '@kadro/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';

import styles from '../../../../../components/admin/admin.module.css';
import { Notice, PageHeading, readProblemMessage } from '../../../../../components/admin/frames';
import { auditActionLabel, formatDateTime, shortId } from '../../../../../components/admin/labels';
import { ADMIN_PATHS, withQuery } from '../../../../../components/admin/paths';
import { adminRead, pickQuery } from '../../../../../lib/admin/server-api';
import { followAuthRedirect } from '../../../../../lib/admin/session';
import { GET as listAuditLogsRoute } from '../../../../api/v1/admin/audit-logs/route';

export const metadata: Metadata = { title: 'Denetim kaydı' };

const auditPage = paginatedResponseSchema(auditLogEntrySchema);

/** Audit log viewer (`GET admin/audit-logs`, admin only); rows never include the IP hash. */
export default async function AuditLogPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = pickQuery(params, ['action', 'targetType', 'target', 'actor', 'cursor']);
  const read = await adminRead(listAuditLogsRoute, auditPage, {
    path: '/api/v1/admin/audit-logs',
    query,
  });
  followAuthRedirect(read);

  return (
    <>
      <PageHeading
        title="Denetim kaydı"
        lead="Her yönetim işlemi burada bir satır bırakır. Kişisel veri ve IP bilgisi gösterilmez."
      />
      <form className={styles.inlineForm} method="get" action={ADMIN_PATHS.auditLog} role="search">
        <div className={styles.field}>
          <label className={styles.label} htmlFor="audit-action">
            İşlem kodu
          </label>
          <input
            id="audit-action"
            name="action"
            className={styles.input}
            type="text"
            placeholder="venue.verified"
            maxLength={64}
            defaultValue={query.action ?? ''}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="audit-target-type">
            Hedef türü
          </label>
          <input
            id="audit-target-type"
            name="targetType"
            className={styles.input}
            type="text"
            placeholder="venue"
            maxLength={32}
            defaultValue={query.targetType ?? ''}
          />
        </div>
        <button type="submit" className={styles.secondaryButton}>
          Filtrele
        </button>
      </form>
      {read.kind !== 'ok' ? (
        <Notice>{readProblemMessage(read.kind)}</Notice>
      ) : read.data.items.length === 0 ? (
        <Notice>Bu filtreye uyan kayıt yok.</Notice>
      ) : (
        <section className={styles.section} aria-label="Denetim kayıtları">
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Zaman</th>
                  <th scope="col">Kim</th>
                  <th scope="col">İşlem</th>
                  <th scope="col">Hedef</th>
                  <th scope="col">Ayrıntı</th>
                </tr>
              </thead>
              <tbody>
                {read.data.items.map((entry) => (
                  <tr key={entry.id} data-audit-action={entry.action}>
                    <td>
                      <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                    </td>
                    <td>{entry.actor === null ? 'Sistem' : entry.actor.displayName}</td>
                    <td>
                      {auditActionLabel(entry.action)}
                      <br />
                      <code>{entry.action}</code>
                    </td>
                    <td>
                      {entry.targetType}
                      {entry.targetId === null ? null : (
                        <>
                          {' '}
                          <code title={entry.targetId}>{shortId(entry.targetId)}</code>
                        </>
                      )}
                    </td>
                    <td>
                      {Object.entries(entry.metadata).map(([key, value]) => (
                        <div key={key}>
                          <code>{key}</code>: {String(value)}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {read.data.nextCursor === null ? null : (
            <div className={styles.pager}>
              <Link
                className={styles.secondaryButton}
                href={withQuery(ADMIN_PATHS.auditLog, {
                  action: query.action,
                  targetType: query.targetType,
                  target: query.target,
                  actor: query.actor,
                  cursor: read.data.nextCursor,
                })}
              >
                Sonraki sayfa
              </Link>
            </div>
          )}
        </section>
      )}
    </>
  );
}
