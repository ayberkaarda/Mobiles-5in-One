import { FACTS } from './facts';
import { GUIDES } from './guides';
import { STATIC_PAGES } from './pages';

/** Paths of the content routes registered in the router; links must resolve to one of them. */
export function contentPaths(): string[] {
  return [
    FACTS.topLevelPaths.home,
    ...STATIC_PAGES.map((page) => page.path),
    ...GUIDES.map((guide) => guide.path),
  ];
}

/** Machine files served by the web server next to the pages. */
export const MACHINE_PATHS = ['/sitemap.xml', '/llms.txt', '/llms-full.txt'] as const;
