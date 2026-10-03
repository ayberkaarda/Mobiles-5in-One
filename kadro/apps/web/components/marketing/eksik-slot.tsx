import { cx } from './class-names';
import styles from './primitives.module.css';

/**
 * EksikSlot({ number?, label?, title?, size?, onPitch?, className? }): the brand's "eksik"
 * glyph, an empty player marker: a dashed ring with the kit number as an outline and no body
 * (direction §2.1, §4.9 empty states). Inline SVG with presentation attributes; colours from the
 * stylesheet (`textMuted` ring and `text` outline on page surfaces, `pitchLine` on the turf).
 *
 * - `number`: optional kit number drawn as an outline inside the ring.
 * - `label`: optional visible caption under the ring, set in capitals (`EKSİK KALECİ`).
 * - `title`: accessible name of the glyph; without it (and without `label`) the glyph is
 *   decorative (`aria-hidden`).
 * - `size`: diameter in px, default 64 (empty states).
 * - `onPitch`: draw for the pitch turf (chalk lines) instead of a page surface.
 */
export function EksikSlot({
  number,
  label,
  title,
  size = 64,
  onPitch = false,
  className,
}: {
  readonly number?: number | string | undefined;
  readonly label?: string | undefined;
  readonly title?: string | undefined;
  readonly size?: number;
  readonly onPitch?: boolean;
  readonly className?: string | undefined;
}) {
  const accessibleName = title ?? label;
  return (
    <span className={cx(styles.eksik, onPitch && styles.eksikOnPitch, className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        role={accessibleName === undefined ? undefined : 'img'}
        aria-label={accessibleName}
        aria-hidden={accessibleName === undefined ? true : undefined}
        focusable="false"
      >
        <circle
          className={styles.eksikRing}
          cx="32"
          cy="32"
          r="29"
          strokeWidth="2"
          strokeDasharray="4 4"
        />
        {number === undefined ? null : (
          <text
            className={styles.eksikNumber}
            x="32"
            y="41"
            fontSize="26"
            strokeWidth="2.25"
            strokeLinejoin="round"
            textAnchor="middle"
          >
            {number}
          </text>
        )}
      </svg>
      {label === undefined ? null : (
        <span className={styles.eksikLabel} aria-hidden="true">
          {label}
        </span>
      )}
    </span>
  );
}
