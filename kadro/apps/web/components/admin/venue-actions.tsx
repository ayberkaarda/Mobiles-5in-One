'use client';

import { useRouter } from 'next/navigation';

import styles from './admin.module.css';
import { useAdminMutation } from './use-admin-mutation';

/**
 * Verify or unverify one venue (`PATCH admin/venues/:id`, `venue.verify`, audited), then
 * re-render the list from the server.
 */
export function VenueVerifyButton({
  venueId,
  venueName,
  verified,
  csrfCookieName,
}: {
  readonly venueId: string;
  readonly venueName: string;
  readonly verified: boolean;
  readonly csrfCookieName: string;
}) {
  const router = useRouter();
  const { state, run } = useAdminMutation(csrfCookieName);
  const busy = state.status === 'pending';
  const next = !verified;
  return (
    <div className={styles.actions}>
      <button
        type="button"
        className={next ? styles.button : styles.dangerButton}
        aria-disabled={busy}
        aria-label={`${venueName}: ${next ? 'onayla' : 'onayı kaldır'}`}
        onClick={() => {
          void run({ kind: 'verifyVenue', id: venueId, body: { verified: next } }).then(
            (outcome) => {
              if (outcome?.kind === 'ok') {
                router.refresh();
              }
            },
          );
        }}
      >
        {busy ? 'Kaydediliyor…' : next ? 'Onayla' : 'Onayı kaldır'}
      </button>
      <span role="status" aria-live="polite" className={styles.error}>
        {state.status === 'failure' ? state.message : ''}
      </span>
    </div>
  );
}
