import type { ReactNode } from 'react';

import { cx } from './class-names';
import styles from './primitives.module.css';

/**
 * Page sections of the marketing pages (direction §4.3, §4.4).
 *
 * - `Section({ id?, labelledBy?, density?, tone?, ruled?, width?, className?, children })`: a
 *   `<section>` with the vertical rhythm and a centred {@link Container} inside.
 *   `density`: `default` (96 px top and bottom), `dense` (64 px: venue facts, FAQ) or `hero`
 *   (96 / 128). `tone`: `default` (page `background`), `surface` or `sunken` (the download band).
 *   `ruled`: a 1 px `border` line on top (the "who it is for" list). `width`: `wide` (default,
 *   1200 px grid) or `prose` (68ch text column). `labelledBy`: id of the section heading.
 * - `Container({ width?, className?, children })`: the centred column alone, with the page gutter
 *   (24 px, 20 px under 640 px).
 */
export type SectionDensity = 'default' | 'dense' | 'hero';
export type SectionTone = 'default' | 'surface' | 'sunken';
export type ContainerWidth = 'wide' | 'prose';

export function Container({
  width = 'wide',
  className,
  children,
}: {
  readonly width?: ContainerWidth;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <div className={cx(styles.container, width === 'prose' && styles.containerProse, className)}>
      {children}
    </div>
  );
}

export function Section({
  id,
  labelledBy,
  density = 'default',
  tone = 'default',
  ruled = false,
  width = 'wide',
  className,
  children,
}: {
  readonly id?: string | undefined;
  readonly labelledBy?: string | undefined;
  readonly density?: SectionDensity;
  readonly tone?: SectionTone;
  readonly ruled?: boolean;
  readonly width?: ContainerWidth;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cx(
        density === 'dense'
          ? styles.sectionDense
          : density === 'hero'
            ? styles.sectionHero
            : styles.section,
        tone === 'surface' && styles.toneSurface,
        tone === 'sunken' && styles.toneSunken,
        ruled && styles.ruled,
        className,
      )}
    >
      <Container width={width}>{children}</Container>
    </section>
  );
}
