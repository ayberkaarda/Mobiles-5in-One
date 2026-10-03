import { cx } from './class-names';
import styles from './primitives.module.css';

/**
 * Wordmark({ title?, className? }): the Kadro wordmark as inline SVG (`packages/brand/logo/
 * kadro-wordmark.svg`, view box 3152 × 861, 3.66:1). The letters and the centre-circle O are
 * filled with `--k-color-text`, so the mark follows the scheme of the page; the ball spot is the
 * accent. Height is 28 px by default (set another with `className`), width follows the ratio.
 *
 * - `title`: accessible name. Leave it out when the wordmark sits inside a link or element that is
 *   already named (the header link "Kadro ana sayfa"); the SVG is then `aria-hidden`.
 */
const LETTERS =
  'M0 686V-1H161V302L346 -1H525L345 287L531 686H349L236 422L161 510V686Z M503 686 687 -1H897L1082 686H911L881 561H697L668 686ZM724 432H855L817 261Q815 253 812 238.5Q809 224 806 207Q803 190 799.5 173Q796 156 793 142H786Q783 159 778.5 181.5Q774 204 769.5 225Q765 246 762 261Z M1140 686V-1H1376Q1468 -1 1525.5 35Q1583 71 1610 146.5Q1637 222 1637 341Q1637 458 1609.5 535Q1582 612 1524 649Q1466 686 1373 686ZM1301 551H1365Q1393 551 1413.5 542Q1434 533 1447 513.5Q1460 494 1466 462.5Q1472 431 1472 386V307Q1472 262 1466 229.5Q1460 197 1447 175.5Q1434 154 1413.5 143.5Q1393 133 1365 133H1301Z M1729 686V-1H2017Q2093 -1 2138 26.5Q2183 54 2203 101.5Q2223 149 2223 207Q2223 270 2203 319.5Q2183 369 2140 399L2246 686H2073L1991 443H1890V686ZM1890 315H1991Q2027 315 2043.5 288.5Q2060 262 2060 219Q2060 190 2053 170.5Q2046 151 2030.5 140Q2015 129 1989 129H1890Z';

export const WORDMARK_VIEW_BOX = '-75 -88 3152 861';

export function Wordmark({
  title,
  className,
}: {
  readonly title?: string | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <svg
      className={cx(styles.wordmark, className)}
      viewBox={WORDMARK_VIEW_BOX}
      role={title === undefined ? undefined : 'img'}
      aria-label={title}
      aria-hidden={title === undefined ? true : undefined}
      focusable="false"
    >
      <path className={styles.wordmarkInk} d={LETTERS} />
      <circle className={styles.wordmarkRing} cx="2646.5" cy="342.5" r="275" strokeWidth="161" />
      <circle className={styles.wordmarkSpot} cx="2646.5" cy="342.5" r="96" />
    </svg>
  );
}
