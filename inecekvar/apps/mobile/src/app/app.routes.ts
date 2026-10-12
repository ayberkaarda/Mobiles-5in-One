import { Route } from '@angular/router';
import { signedInGuard } from './auth/auth.guard';
import { contributorCopy } from './i18n/contrib-copy';

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
        path: 'katki/kayit',
        canActivate: [contributorCopy, signedInGuard],
        loadComponent: () => import('./pages/recorder.page').then((m) => m.RecorderPage),
      },
      {
        path: 'katki/oneri',
        canActivate: [contributorCopy, signedInGuard],
        loadComponent: () => import('./pages/proposal.page').then((m) => m.ProposalPage),
      },
      {
        path: 'katki/onerilerim',
        canActivate: [contributorCopy, signedInGuard],
        loadComponent: () => import('./pages/proposals.page').then((m) => m.ProposalsPage),
      },
      {
        path: 'hat/:slug',
        loadComponent: () => import('./pages/line.page').then((m) => m.LinePage),
      },
      {
        path: 'durak/:slug',
        loadComponent: () => import('./pages/stop.page').then((m) => m.StopPage),
      },
      {
        path: 'giris',
        canActivate: [contributorCopy],
        loadComponent: () => import('./pages/signin.page').then((m) => m.SigninPage),
      },
      {
        path: 'giris/kayit',
        canActivate: [contributorCopy],
        loadComponent: () => import('./pages/register.page').then((m) => m.RegisterPage),
      },
      {
        // The page a magic link opens; the token was already taken from the fragment.
        path: 'giris/baglanti',
        canActivate: [contributorCopy],
        loadComponent: () => import('./pages/magic-link.page').then((m) => m.MagicLinkPage),
      },
      {
        path: 'ayarlar',
        loadComponent: () => import('./pages/settings.page').then((m) => m.SettingsPage),
      },
      {
        path: 'ayarlar/cevrimdisi',
        loadComponent: () => import('./pages/packs.page').then((m) => m.PacksPage),
      },
    ],
  },
  {
    path: '**',
    loadComponent: () => import('./pages/not-found.page').then((m) => m.NotFoundPage),
  },
];
