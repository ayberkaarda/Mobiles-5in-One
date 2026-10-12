import { Route } from '@angular/router';

/** Tab routes use Turkish slugs (the product language); every page is a lazy chunk. */
export const appRoutes: Route[] = [
  {
    path: '',
    loadComponent: () => import('./tabs/tabs.page').then((m) => m.TabsPage),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'ara' },
      {
        path: 'ara',
        loadComponent: () => import('./pages/search.page').then((m) => m.SearchPage),
      },
      {
        path: 'planla',
        loadComponent: () => import('./pages/plan.page').then((m) => m.PlanPage),
      },
      {
        path: 'favoriler',
        loadComponent: () => import('./pages/favorites.page').then((m) => m.FavoritesPage),
      },
      {
        path: 'katki',
        loadComponent: () => import('./pages/contribute.page').then((m) => m.ContributePage),
      },
      {
        path: 'ayarlar',
        loadComponent: () => import('./pages/settings.page').then((m) => m.SettingsPage),
      },
    ],
  },
  {
    path: '**',
    loadComponent: () => import('./pages/not-found.page').then((m) => m.NotFoundPage),
  },
];
