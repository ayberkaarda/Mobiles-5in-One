import type { ReactNode } from 'react';

import { cx } from './class-names';
import styles from './primitives.module.css';

/**
 * DeviceFrame({ label, caption?, className?, children }): our own phone frame (direction §4.7,
 * §4.9): ink bezel (fixed, the same in both schemes), outer radius 44, inner radius 20, `level2`
 * shadow, a 1 px `borderStrong` edge so it stays visible on the night page. No vendor cues.
 *
 * The screen inside always renders in the dark scheme (`data-theme="dark"` on the screen, so the
 * `--k-color-*` roles resolve to their dark values whatever the page scheme), like the app's
 * dark-first captures. The content is a picture of the app, not a working UI: the frame is
 * `role="img"` with `label` as its name, and children must not contain links, buttons or headings.
 * Build the screen from the parts in `app-screens.tsx`.
 *
 * - `label`: accessible description of the screen (`Kadro uygulamasında maç ekranı: ...`).
 * - `caption`: optional visible caption under the frame (`Maç ayrıntısı`).
 * - `children`: the screen content.
 */
export function DeviceFrame({
  label,
  caption,
  className,
  children,
}: {
  readonly label: string;
  readonly caption?: string | undefined;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <figure className={cx(styles.device, className)}>
      <div className={styles.deviceBezel} role="img" aria-label={label}>
        <div className={styles.deviceScreen} data-theme="dark">
          <p className={styles.deviceStatus} aria-hidden="true">
            20:42
          </p>
          {children}
        </div>
      </div>
      {caption === undefined ? null : (
        <figcaption className={styles.deviceCaption}>{caption}</figcaption>
      )}
    </figure>
  );
}
