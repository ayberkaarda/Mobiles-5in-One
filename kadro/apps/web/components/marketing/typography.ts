import styles from './primitives.module.css';

/**
 * typeClassName(variant): the class of a web type role of `@kadro/brand/theme.css`
 * (`--k-type-<variant>-*`, direction §4.2). Display roles (`hero`, `display`, `title1`, `title2`)
 * and numerals use the 75 % width; the rest are read at 100 %. Sizes switch to the mobile web
 * scale under 640 px by themselves. Use on any element: `<h2 className={typeClassName('title1')}>`.
 * `MUTED_CLASS` sets `textMuted` for meta lines and captions.
 */
export type WebTypeVariant =
  | 'hero'
  | 'display'
  | 'title1'
  | 'title2'
  | 'title3'
  | 'lead'
  | 'prose'
  | 'body'
  | 'label'
  | 'caption';

export function typeClassName(variant: WebTypeVariant): string {
  switch (variant) {
    case 'hero':
      return styles.hero ?? '';
    case 'display':
      return styles.display ?? '';
    case 'title1':
      return styles.title1 ?? '';
    case 'title2':
      return styles.title2 ?? '';
    case 'title3':
      return styles.title3 ?? '';
    case 'lead':
      return styles.lead ?? '';
    case 'prose':
      return styles.prose ?? '';
    case 'body':
      return styles.body ?? '';
    case 'label':
      return styles.label ?? '';
    case 'caption':
      return styles.caption ?? '';
  }
}

export const MUTED_CLASS: string = styles.muted ?? '';
