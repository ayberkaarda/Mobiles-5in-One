import styles from './marketing.module.css';
import { STORE_ENTRIES, type StoreEntry } from './site';

/**
 * Store entries of the download section. An entry without a listing renders as text ("yakında"),
 * never as a link to a guessed URL; a published entry opens the store listing.
 */
export function StoreBadges({
  entries = STORE_ENTRIES,
}: {
  readonly entries?: readonly StoreEntry[];
}) {
  return (
    <ul className={styles.storeList}>
      {entries.map((entry) => (
        <li key={entry.store}>
          {entry.href === null ? (
            <span className={styles.storeBadge}>
              <span className={styles.storeName}>{entry.label}</span>
              <span className={styles.storeStatus}>Yakında</span>
            </span>
          ) : (
            <a
              className={`${styles.storeBadge} ${styles.storeLink}`}
              href={entry.href}
              rel="noopener"
            >
              <span className={styles.storeName}>{entry.label}</span>
              <span className={styles.storeStatus}>İndir</span>
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
