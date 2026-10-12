import { Route } from '@angular/router';
import { durumResolver } from './pages/durum.page';

export const appRoutes: Route[] = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./home/home').then((m) => m.Home),
  },
  {
    path: 'durum',
    resolve: { health: durumResolver },
    loadComponent: () => import('./pages/durum.page').then((m) => m.DurumPage),
  },
  {
    path: '**',
    loadComponent: () => import('./pages/not-found.page').then((m) => m.NotFoundPage),
  },
];
