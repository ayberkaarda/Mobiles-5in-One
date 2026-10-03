import Link from 'next/link';

import styles from './seo.module.css';

/**
 * Breadcrumb of the SEO pages: a semantic ordered list (the trail has an order) that is drawn
 * without list numbers; the separator is a CSS slash and the current page carries `aria-current`.
 */
export function Breadcrumb({ current }: { readonly current: string }) {
  return (
    <nav aria-label="Konum">
      <ol className={styles.crumbs}>
        <li>
          <Link href="/">Ana sayfa</Link>
        </li>
        <li aria-current="page">{current}</li>
      </ol>
    </nav>
  );
}
