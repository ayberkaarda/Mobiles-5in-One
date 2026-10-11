import { RenderMode, ServerRoute } from '@angular/ssr';

// Static pages are prerendered; every other path is rendered on the server per request.
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: '**', renderMode: RenderMode.Server },
];
