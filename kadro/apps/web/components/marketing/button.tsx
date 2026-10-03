import type { Route } from 'next';
import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cx } from './class-names';
import styles from './primitives.module.css';

/**
 * Buttons of the marketing pages (direction §4.9).
 *
 * - `ButtonLink({ href, variant?, className?, children })`: a link styled as a button. `href` is a
 *   typed route (`/ozellikler`, `/#indir`) rendered with `next/link`, or an in-page anchor
 *   (`#indir`) rendered as a plain `<a>`.
 * - `Button({ variant?, className?, type?, ...button attributes })`: a `<button>`, `type` defaults
 *   to `button`.
 * - `buttonClassName(variant)`: the class alone, for an element that cannot be one of the above.
 *
 * Variants: `primary` (green fill: deep green with a white label on light, bright green with an
 * ink label on dark), `accent` (orange fill, ink label; at most one per viewport), `secondary`
 * (surface with a `borderStrong` outline), `text` (green underlined text). Height 48 px, radius 8,
 * one line, max three words.
 */
export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'text';

export function buttonClassName(variant: ButtonVariant = 'primary'): string {
  switch (variant) {
    case 'text':
      return cx(styles.textButton);
    case 'accent':
      return cx(styles.button, styles.accent);
    case 'secondary':
      return cx(styles.button, styles.secondary);
    case 'primary':
      return cx(styles.button, styles.primary);
  }
}

export function ButtonLink({
  href,
  variant = 'primary',
  className,
  children,
}: {
  readonly href: Route | `#${string}`;
  readonly variant?: ButtonVariant;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  const classes = cx(buttonClassName(variant), className);
  if (href.startsWith('#')) {
    return (
      <a href={href} className={classes}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href as Route} className={classes}>
      {children}
    </Link>
  );
}

export function Button({
  variant = 'primary',
  className,
  type = 'button',
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'type'> & {
  readonly variant?: ButtonVariant;
  readonly className?: string | undefined;
  readonly type?: 'button' | 'submit' | 'reset';
  readonly children: ReactNode;
}) {
  return (
    <button {...rest} type={type} className={cx(buttonClassName(variant), className)}>
      {children}
    </button>
  );
}
