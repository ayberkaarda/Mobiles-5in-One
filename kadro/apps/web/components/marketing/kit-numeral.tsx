import { cx } from './class-names';
import styles from './primitives.module.css';

/**
 * KitNumeral({ value, of?, size?, label?, className? }): a count, time, fee or date set like the
 * number on a shirt back (direction §2.1, §4.2): Archivo at the 75 % width, heavy, tabular figures.
 *
 * - `value`: the figure (`13`, `'21:00'`, `'200 ₺'`).
 * - `of`: optional total shown muted after a slash (`value={13} of={14}` renders `13/14`).
 * - `size`: `numeral` (default, 40 px; counts in rows, timeline times) or `xl` (112 px, 72 px on
 *   mobile; the hero squad count).
 * - `label`: optional caption under the figure (`gelen oyuncu`); the figure and the label then
 *   form one block.
 *
 * Numbers in examples come from the `content.ts` fixtures, never invented in a page.
 */
export function KitNumeral({
  value,
  of,
  size = 'numeral',
  label,
  className,
}: {
  readonly value: number | string;
  readonly of?: number | string | undefined;
  readonly size?: 'numeral' | 'xl';
  readonly label?: string | undefined;
  readonly className?: string | undefined;
}) {
  const figure = (
    <span className={cx(size === 'xl' ? styles.numeralXl : styles.numeral, className)}>
      {value}
      {of === undefined ? null : <span className={styles.numeralOf}>/{of}</span>}
    </span>
  );
  if (label === undefined) {
    return figure;
  }
  return (
    <span className={styles.numeralBlock}>
      {figure}
      <span className={cx(styles.caption, styles.muted)}>{label}</span>
    </span>
  );
}
