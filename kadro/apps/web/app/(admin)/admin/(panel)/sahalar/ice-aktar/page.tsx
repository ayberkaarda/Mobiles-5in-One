import { VENUE_IMPORT_COLUMNS, VENUE_IMPORT_REQUIRED_COLUMNS } from '@kadro/contracts';
import type { Metadata } from 'next';

import styles from '../../../../../../components/admin/admin.module.css';
import { Notice, PageHeading } from '../../../../../../components/admin/frames';
import { VenueImportForm } from '../../../../../../components/admin/venue-import-form';
import { csrfCookieName, panelViewer } from '../../../../../../lib/admin/session';

export const metadata: Metadata = { title: 'Saha içe aktarma' };

const REQUIRED: ReadonlySet<string> = new Set(VENUE_IMPORT_REQUIRED_COLUMNS);

/** Venue CSV upload (`POST admin/venues/import`, admin only, ADR-0064 §6, ADR-0067 §9-10). */
export default async function VenueImportPage() {
  const viewer = await panelViewer();
  const isAdmin = viewer.kind === 'staff' && viewer.isAdmin;
  return (
    <>
      <PageHeading
        title="Saha içe aktarma"
        lead="Gerçek saha listeleri yalnızca bu CSV içe aktarmasıyla eklenir. Aktarılan sahalar onaylı olarak oluşturulur; aynı ilçede aynı adlı saha atlanır."
      />
      {isAdmin ? (
        <section className={styles.section} aria-labelledby="import-upload">
          <h2 id="import-upload" className={styles.label}>
            Dosya yükle
          </h2>
          <VenueImportForm csrfCookieName={await csrfCookieName()} />
        </section>
      ) : (
        <Notice>İçe aktarmayı yalnızca yöneticiler başlatabilir.</Notice>
      )}
      <section className={styles.section} aria-labelledby="import-format">
        <h2 id="import-format" className={styles.label}>
          Dosya biçimi
        </h2>
        <p className={styles.hint}>
          UTF-8, virgülle ayrılmış, ilk satır başlık. En fazla 5 000 satır. il ve ilce sütunları
          ilçe kısa adlarıdır (ör. istanbul, kadikoy); evet/hayır alanları true ya da false;
          fiyatlar saatlik kuruş.
        </p>
        <ul>
          {VENUE_IMPORT_COLUMNS.map((column) => (
            <li key={column}>
              <code>{column}</code>
              {REQUIRED.has(column) ? ' (zorunlu)' : ''}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
