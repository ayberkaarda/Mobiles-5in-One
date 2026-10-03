import { adminUserSchema, paginatedResponseSchema, PLATFORM_ROLES } from '@kadro/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';

import styles from '../../../../../components/admin/admin.module.css';
import { Notice, PageHeading, readProblemMessage } from '../../../../../components/admin/frames';
import { formatDateTime, roleLabel } from '../../../../../components/admin/labels';
import { ADMIN_PATHS, withQuery } from '../../../../../components/admin/paths';
import { UserActions } from '../../../../../components/admin/user-actions';
import { adminRead, pickQuery } from '../../../../../lib/admin/server-api';
import { csrfCookieName, followAuthRedirect, panelViewer } from '../../../../../lib/admin/session';
import { GET as listUsersRoute } from '../../../../api/v1/admin/users/route';

export const metadata: Metadata = { title: 'Kullanıcılar' };

const userPage = paginatedResponseSchema(adminUserSchema);

/** Accounts with masked email (`GET admin/users`); role and ban changes for admins. */
export default async function UsersPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = pickQuery(params, ['q', 'role', 'cursor']);
  const read = await adminRead(listUsersRoute, userPage, { path: '/api/v1/admin/users', query });
  followAuthRedirect(read);
  const viewer = await panelViewer();
  const viewerId = viewer.kind === 'staff' ? viewer.me.id : null;
  const isAdmin = viewer.kind === 'staff' && viewer.isAdmin;
  const cookieName = await csrfCookieName();

  return (
    <>
      <PageHeading
        title="Kullanıcılar"
        lead="E-posta adresleri maskelenmiş gösterilir. Rol değişikliği ve engelleme her seferinde doğrulama uygulamandan yeni bir kod ister."
      />
      <form className={styles.inlineForm} method="get" action={ADMIN_PATHS.users} role="search">
        <div className={styles.field}>
          <label className={styles.label} htmlFor="user-search">
            Görünen ad
          </label>
          <input
            id="user-search"
            name="q"
            className={styles.input}
            type="search"
            minLength={2}
            maxLength={60}
            defaultValue={query.q ?? ''}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="user-role">
            Rol
          </label>
          <select
            id="user-role"
            name="role"
            className={styles.select}
            defaultValue={query.role ?? ''}
          >
            <option value="">Tümü</option>
            {PLATFORM_ROLES.map((role) => (
              <option key={role} value={role}>
                {roleLabel(role)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={styles.secondaryButton}>
          Filtrele
        </button>
      </form>
      {read.kind !== 'ok' ? (
        <Notice>{readProblemMessage(read.kind)}</Notice>
      ) : read.data.items.length === 0 ? (
        <Notice>Bu filtreye uyan kullanıcı yok.</Notice>
      ) : (
        <section className={styles.section} aria-label="Kullanıcı listesi">
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Kullanıcı</th>
                  <th scope="col">Rol</th>
                  <th scope="col">Durum</th>
                  <th scope="col">Kayıt</th>
                  {isAdmin ? <th scope="col">İşlem</th> : null}
                </tr>
              </thead>
              <tbody>
                {read.data.items.map((user) => (
                  <tr key={user.id} data-user-id={user.id}>
                    <td>
                      <strong>{user.displayName}</strong>
                      <br />
                      {user.maskedEmail}
                    </td>
                    <td>
                      <span className={styles.badge} data-testid="user-role">
                        {roleLabel(user.role)}
                      </span>
                      {user.role === 'user' ? null : (
                        <>
                          <br />
                          {user.totpEnrolled ? 'Doğrulama kurulu' : 'Doğrulama kurulmamış'}
                        </>
                      )}
                    </td>
                    <td>
                      <span className={styles.badge} data-testid="user-state">
                        {user.deactivatedAt === null ? 'Aktif' : 'Engelli'}
                      </span>
                      {user.emailVerified ? null : (
                        <>
                          <br />
                          E-posta doğrulanmadı
                        </>
                      )}
                    </td>
                    <td>
                      <time dateTime={user.createdAt}>{formatDateTime(user.createdAt)}</time>
                    </td>
                    {isAdmin ? (
                      <td>
                        {user.id === viewerId ? (
                          <span className={styles.hint}>Kendi hesabın</span>
                        ) : (
                          <UserActions
                            userId={user.id}
                            displayName={user.displayName}
                            role={user.role}
                            deactivated={user.deactivatedAt !== null}
                            csrfCookieName={cookieName}
                          />
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {read.data.nextCursor === null ? null : (
            <div className={styles.pager}>
              <Link
                className={styles.secondaryButton}
                href={withQuery(ADMIN_PATHS.users, {
                  q: query.q,
                  role: query.role,
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
