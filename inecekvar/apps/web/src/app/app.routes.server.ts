import { RenderMode, ServerRoute } from '@angular/ssr';
import { contentServerRoutes } from './content/site/content.server-routes';

// Every path is rendered on the server per request.
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Server },
  { path: 'durum', renderMode: RenderMode.Server },
  ...contentServerRoutes,
  // The admin area renders in the browser only; the server sends the client shell.
  { path: 'admin', renderMode: RenderMode.Client },
  { path: 'admin/**', renderMode: RenderMode.Client },
  { path: ':sehir', renderMode: RenderMode.Server },
  { path: ':sehir/hatlar', renderMode: RenderMode.Server },
  { path: ':sehir/hat/:slug', renderMode: RenderMode.Server },
  { path: ':sehir/durak/:slug', renderMode: RenderMode.Server },
  { path: ':sehir/rota/:pair', renderMode: RenderMode.Server },
  { path: '**', renderMode: RenderMode.Server },
];
