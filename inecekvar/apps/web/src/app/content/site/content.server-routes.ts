import { RenderMode, ServerRoute } from '@angular/ssr';
import { FIXED_CONTENT_PATHS } from './content.routes';

// Rendered on the server per request behind the page cache, like every other route: a
// build-time prerender would bake a build-time origin into canonical URLs (ADR-0038 item 6).
export const contentServerRoutes: ServerRoute[] = [
  ...FIXED_CONTENT_PATHS.map((path): ServerRoute => ({
    path: path.slice(1),
    renderMode: RenderMode.Server,
  })),
  { path: 'rehber/:slug', renderMode: RenderMode.Server },
];
