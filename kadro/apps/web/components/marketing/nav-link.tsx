'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** A navigation link that marks the current page with `aria-current="page"`. */
export function NavLink({
  href,
  className,
  children,
}: {
  readonly href: Route;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <Link href={href} className={className} aria-current={pathname === href ? 'page' : undefined}>
      {children}
    </Link>
  );
}
