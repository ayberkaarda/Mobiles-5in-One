import type { ReactNode } from 'react';

import { cx } from './class-names';
import { EksikSlot } from './eksik-slot';
import styles from './primitives.module.css';

/**
 * FactGrid({ items, columns?, className? }): facts as a definition grid, never as `label: value`
 * bullets (direction §4.4, §5.9). One `<dl>`; each item is a `<div>` group with the term, an
 * optional figure in kit numerals and the sentences that explain it. Rows are separated by a 1 px
 * `border` hairline.
 *
 * - `items[]`:
 *   - `term`: the name of the fact (`Katılım`, `Konum`), set in `title3`;
 *   - `figure?`: the number of the fact (`13/14`, `2.800 ₺`), right of the term in `numeral`;
 *   - `empty?`: draw a string or number figure as the eksik glyph (`EksikSlot`: dashed ring with
 *     the number as an outline, e.g. `2` missing); the figure stays its accessible name;
 *   - `text?`: one sentence under the term (muted);
 *   - `details?`: further sentences, one `<dd>` each;
 *   - `id?`: id of the group, so a page can link to the fact (`/ozellikler#eksik-var`).
 * - `columns`: `1` (default) or `2` (two columns from 900 px, the venue facts).
 */
export interface Fact {
  readonly id?: string | undefined;
  readonly term: ReactNode;
  readonly figure?: ReactNode;
  readonly empty?: boolean | undefined;
  readonly text?: ReactNode;
  readonly details?: readonly ReactNode[] | undefined;
}

export function FactGrid({
  items,
  columns = 1,
  className,
}: {
  readonly items: readonly Fact[];
  readonly columns?: 1 | 2;
  readonly className?: string | undefined;
}) {
  return (
    <dl className={cx(styles.facts, columns === 2 && styles.factsTwo, className)}>
      {items.map((item, index) => (
        <div key={item.id ?? index} id={item.id} className={styles.fact}>
          <dt className={styles.factTerm}>{item.term}</dt>
          {item.figure === undefined ? null : (
            <dd className={styles.factFigure}>
              {item.empty === true &&
              (typeof item.figure === 'string' || typeof item.figure === 'number') ? (
                <EksikSlot number={item.figure} title={String(item.figure)} size={56} />
              ) : (
                item.figure
              )}
            </dd>
          )}
          {item.text === undefined ? null : <dd className={styles.factText}>{item.text}</dd>}
          {(item.details ?? []).map((detail, detailIndex) => (
            <dd key={detailIndex} className={styles.factText}>
              {detail}
            </dd>
          ))}
        </div>
      ))}
    </dl>
  );
}
