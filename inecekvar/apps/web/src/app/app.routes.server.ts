import { RenderMode, ServerRoute } from '@angular/ssr';

// Every path is rendered on the server per request.
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Server },
  { path: 'durum', renderMode: RenderMode.Server },
  { path: '**', renderMode: RenderMode.Server },
];
