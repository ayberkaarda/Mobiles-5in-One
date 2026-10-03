import type { ReactNode } from 'react';

import { cx } from './class-names';
import styles from './primitives.module.css';

/**
 * Chip({ tone?, size?, className?, children }): a short label for a position, level, facility,
 * filter or state (direction §4.9). Radius 4, label 14 px weight 500, never a link or a button.
 *
 * - `tone`:
 *   - `default`: `fillMuted` with `text` (position, level, facility, a filter at rest);
 *   - `selected`: `inverse` with `onInverse` (the chosen filter);
 *   - `sample`: `warning` with `onWarning`, the `ÖRNEK` tag placed beside the title it qualifies;
 *   - `in` / `maybe` / `out`: the RSVP state fills (`primary`, `warning`, `danger`) with their
 *     on-colours; the label always names the state.
 * - `size`: `md` (default, 32 px high) or `sm` (24 px, inside rows and the app screens).
 *
 * Orange is never a chip colour (direction §4.1).
 */
export type ChipTone = 'default' | 'selected' | 'sample' | 'in' | 'maybe' | 'out';
export type ChipSize = 'md' | 'sm';

function toneClass(tone: ChipTone): string | undefined {
  switch (tone) {
    case 'selected':
      return styles.chipSelected;
    case 'sample':
      return styles.chipSample;
    case 'in':
      return styles.chipIn;
    case 'maybe':
      return styles.chipMaybe;
    case 'out':
      return styles.chipOut;
    case 'default':
      return undefined;
  }
}

export function Chip({
  tone = 'default',
  size = 'md',
  className,
  children,
}: {
  readonly tone?: ChipTone;
  readonly size?: ChipSize;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <span className={cx(styles.chip, size === 'sm' && styles.chipSm, toneClass(tone), className)}>
      {children}
    </span>
  );
}
