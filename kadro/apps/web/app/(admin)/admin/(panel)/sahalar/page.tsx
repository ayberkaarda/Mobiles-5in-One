import { adminVenueSchema, paginatedResponseSchema } from '@kadro/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';

import styles from '../../../../../components/admin/admin.module.css';
import { Notice, PageHeading, readProblemMessage } from '../../../../../components/admin/frames';
import { formatDateTime } from '../../../../../components/admin/labels';
import { ADMIN_PATHS, withQuery } from '../../../../../components/admin/paths';
import { VenueVerifyButton } from '../../../../../components/admin/venue-actions';
import { adminRead, districtLabels, pickQuery } from '../../../../../lib/admin/server-api';
import { csrfCookieName, followAuthRedirect } from '../../../../../lib/admin/session';
import { GET as listVenuesRoute } from '../../../../api/v1/admin/venues/route';

export const metadata: Metadata = { title: 'Saha onayı' };

const venuePage = paginatedResponseSchema(adminVenueSchema);

/** `verified` filter of the page: pending (default), verified or every venue. */
function verifiedFilter(value: string | string[] | undefined): 'false' | 'true' | 'all' {
  return value === 'true' || value === 'all' ? value : 'false';
}

const FILTERS = [
  { value: 'false', label: 'Onay bekleyen' },
  { value: 'true', label: 'Onaylı' },
  { value: 'all', label: 'Tümü' },
] as const;

/** Venue verification queue (`GET admin/venues`, `PATCH admin/venues/:id`). */
export default async function VenueQueuePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const verified = verifiedFilter(params.verified);
  const query = pickQuery(params, ['q', 'cursor']);
  const read = await adminRead(listVenuesRoute, venuePage, {
    path: '/api/v1/admin/venues',
    query: verified === 'all' ? query : { ...query, verified },
  });
  followAuthRedirect(read);
  const cookieName = await csrfCookieName();
  const labels =
    read.kind === 'ok'
      ? await districtLabels(read.data.items.map((v) => v.districtId))
      : new Map<string, string>();

  return (
    <>
      <PageHeading
        title="Saha onayı"
        lead="Kullanıcıların eklediği sahaları kontrol edip onayla. Onaylı sahalar rozetle gösterilir."
      />
      <form className={styles.inlineForm} method="get" action={ADMIN_PATHS.venues} role="search">
        <div className={styles.field}>
          <label className={styles.label} htmlFor="venue-filter">
            Durum
          </label>
          <select
            id="venue-filter"
            name="verified"
            className={styles.select}
            defaultValue={verified}
          >
            {FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="venue-search">
            Saha adı
          </label>
          <input
            id="venue-search"
            name="q"
            className={styles.input}
            type="search"
            minLength={2}
            maxLength={60}
            defaultValue={query.q ?? ''}
          />
        </div>
        <button type="submit" className={styles.secondaryButton}>
          Filtrele
        </button>
      </form>
      {read.kind !== 'ok' ? (
        <Notice>{readProblemMessage(read.kind)}</Notice>
      ) : read.data.items.length === 0 ? (
        <Notice>Bu filtreye uyan saha yok.</Notice>
      ) : (
        <section className={styles.section} aria-label="Sahalar">
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Saha</th>
                  <th scope="col">İl / ilçe</th>
                  <th scope="col">Bilgi</th>
                  <th scope="col">Eklenme</th>
                  <th scope="col">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {read.data.items.map((venue) => (
                  <tr key={venue.id} data-venue-id={venue.id}>
                    <td>
                      <strong>{venue.name}</strong>
                      <br />
                      <span className={styles.badge}>
                        {venue.verified ? 'Onaylı' : 'Onay bekliyor'}
                      </span>{' '}
                      {venue.isSample ? <span className={styles.badge}>Örnek</span> : null}
                    </td>
                    <td>{labels.get(venue.districtId) ?? '—'}</td>
                    <td>
                      {venue.indoor ? 'Kapalı' : 'Açık'}
                      {venue.address === null ? null : (
                        <>
                          <br />
                          {venue.address}
                        </>
                      )}
                      {venue.phone === null ? null : (
                        <>
                          <br />
                          {venue.phone}
                        </>
                      )}
                    </td>
                    <td>
                      <time dateTime={venue.createdAt}>{formatDateTime(venue.createdAt)}</time>
                    </td>
                    <td>
                      <VenueVerifyButton
                        venueId={venue.id}
                        venueName={venue.name}
                        verified={venue.verified}
                        csrfCookieName={cookieName}
                      />
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
                href={withQuery(ADMIN_PATHS.venues, {
                  verified,
                  q: query.q,
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
