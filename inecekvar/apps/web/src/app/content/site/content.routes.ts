import { Route } from '@angular/router';
import { FACTS } from '../../../content/facts';
import { contentResolver } from './content-view';

const load = () => import('./content.page').then((m) => m.ContentPage);

/** Paths of the fixed content pages; the guides live under `rehber/:slug`. */
export const FIXED_CONTENT_PATHS: readonly string[] = [
  FACTS.topLevelPaths.guides,
  FACTS.topLevelPaths.faq,
  FACTS.topLevelPaths.data,
  FACTS.topLevelPaths.licence,
  FACTS.topLevelPaths.about,
  FACTS.topLevelPaths.privacy,
  FACTS.topLevelPaths.kvkk,
  FACTS.topLevelPaths.deletion,
  FACTS.topLevelPaths.contact,
];

/**
 * Fixed content pages and guides. They are declared before `:sehir` so a city slug can never
 * shadow them.
 */
export const contentRoutes: Route[] = [
  ...FIXED_CONTENT_PATHS.map((path): Route => ({
    path: path.slice(1),
    pathMatch: 'full',
    data: { contentPath: path },
    resolve: { page: contentResolver },
    loadComponent: load,
  })),
  {
    path: 'rehber/:slug',
    pathMatch: 'full',
    resolve: { page: contentResolver },
    loadComponent: load,
  },
];
