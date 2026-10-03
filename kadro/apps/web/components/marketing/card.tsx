import type { ReactNode } from 'react';

import { cx } from './class-names';
import styles from './primitives.module.css';

/**
 * Card({ as?, tone?, labelledBy?, className?, children }): a surface with a 1 px `border`
 * hairline, radius 12 and 24 px padding, no shadow (direction §4.3). Use it only where the
 * content is one object (a match, a call, the invite ticket); a row of equal cards is not a section
 * layout (direction §5.2).
 *
 * - `as`: `div` (default), `article`, `li` or `section`.
 * - `tone`: `surface` (default), `sunken` (a well) or `raised` (a floating layer: `surfaceRaised`
 *   plus `level2`).
 * - `labelledBy`: id of the heading that names the card (`aria-labelledby`).
 */
export type CardTone = 'surface' | 'sunken' | 'raised';

export function Card({
  as: Element = 'div',
  tone = 'surface',
  labelledBy,
  className,
  children,
}: {
  readonly as?: 'div' | 'article' | 'li' | 'section';
  readonly tone?: CardTone;
  readonly labelledBy?: string | undefined;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <Element
      aria-labelledby={labelledBy}
      className={cx(
        styles.card,
        tone === 'sunken' && styles.cardSunken,
        tone === 'raised' && styles.cardRaised,
        className,
      )}
    >
      {children}
    </Element>
  );
}
