import { cx } from './class-names';
import styles from './primitives.module.css';

/**
 * Timeline({ items, label?, headingLevel?, className? }): a sequence keyed to real clock times
 * (direction §4.4 "Maç haftası", §5.2: the only way to show a sequence; no numbered discs). An
 * ordered list with a chalk rail and one node per row; the weekday sits above the time in
 * `numeral`, the figure of the moment (`11/14`, `14 × 200 ₺`) on the right.
 *
 * - `items[]`: `day` (`Pazartesi`), `time` (`20:14`), `title`, `text`, optional `figure` and
 *   `highlight` (the row the sequence leads to, e.g. the match: larger title, filled node).
 * - `label`: accessible name of the list (`aria-label`), when no heading names it.
 * - `headingLevel`: level of the row titles, `3` (default) or `4`, to keep the heading order.
 */
export interface TimelineItem {
  readonly day: string;
  readonly time: string;
  readonly title: string;
  readonly text: string;
  readonly figure?: string | undefined;
  readonly highlight?: boolean | undefined;
}

export function Timeline({
  items,
  label,
  headingLevel = 3,
  className,
}: {
  readonly items: readonly TimelineItem[];
  readonly label?: string | undefined;
  readonly headingLevel?: 3 | 4;
  readonly className?: string | undefined;
}) {
  const Heading = headingLevel === 4 ? 'h4' : 'h3';
  return (
    <ol className={cx(styles.timeline, className)} aria-label={label}>
      {items.map((item) => (
        <li
          key={`${item.day}-${item.time}`}
          className={cx(styles.timelineRow, item.highlight === true && styles.timelineHighlight)}
        >
          <p className={styles.timelineWhen}>
            <span className={styles.timelineDay}>{item.day}</span>{' '}
            <time className={styles.timelineTime}>{item.time}</time>
          </p>
          <div className={styles.timelineWhat}>
            <Heading className={styles.timelineTitle}>{item.title}</Heading>
            <p className={styles.timelineText}>{item.text}</p>
          </div>
          {item.figure === undefined ? null : (
            <p className={styles.timelineFigure}>{item.figure}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
