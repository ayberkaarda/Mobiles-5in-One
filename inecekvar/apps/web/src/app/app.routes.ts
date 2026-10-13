import { Route } from '@angular/router';
import { Home } from './home/home';
import { durumResolver } from './pages/durum.page';
import { contentRoutes } from './content/site/content.routes';
import { adminRoute } from './admin-entry';
import {
  cityHubResolver,
  homeResolver,
  lineListResolver,
  lineResolver,
  routeResolver,
  stopResolver,
} from './content/page-data';

export const appRoutes: Route[] = [
  {
    path: '',
    pathMatch: 'full',
    resolve: { page: homeResolver },
    // Eager: a lazy home chunk is fetched only after main.js runs, one more round trip before
    // the first paint on a slow connection (mobile Lighthouse performance 99 instead of 100).
    component: Home,
  },
  {
    path: 'durum',
    resolve: { health: durumResolver },
    loadComponent: () => import('./pages/durum.page').then((m) => m.DurumPage),
  },
  ...contentRoutes,
  adminRoute,
  {
    path: ':sehir',
    pathMatch: 'full',
    resolve: { page: cityHubResolver },
    loadComponent: () => import('./pages/city-hub.page').then((m) => m.CityHubPage),
  },
  {
    path: ':sehir/hatlar',
    resolve: { page: lineListResolver },
    runGuardsAndResolvers: 'paramsOrQueryParamsChange',
    loadComponent: () => import('./pages/line-list.page').then((m) => m.LineListPage),
  },
  {
    path: ':sehir/hat/:slug',
    resolve: { page: lineResolver },
    loadComponent: () => import('./pages/line.page').then((m) => m.LinePage),
  },
  {
    path: ':sehir/durak/:slug',
    resolve: { page: stopResolver },
    loadComponent: () => import('./pages/stop.page').then((m) => m.StopPage),
  },
  {
    path: ':sehir/rota/:pair',
    resolve: { page: routeResolver },
    loadComponent: () => import('./pages/route.page').then((m) => m.RoutePage),
  },
  {
    path: '**',
    loadComponent: () => import('./pages/not-found.page').then((m) => m.NotFoundPage),
  },
];
