import { ChangeDetectionStrategy, Component, inject, InjectionToken } from '@angular/core';
import type { Route, Routes } from '@angular/router';

export type AdminRoutesLoader = () => Promise<Routes>;

/** Shown only if the admin bundle is missing (a server build); the real area replaces it. */
@Component({
  selector: 'iv-admin-placeholder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p>Yönetim paneli yükleniyor…</p>`,
})
export class AdminPlaceholder {}

/**
 * Loads the admin routes. Only the browser entry (main.ts) provides the real loader, so the
 * server bundle and every public chunk stay free of the admin code and of the session store
 * (ADR-0038, ADR-0041); `/admin` renders on the client only.
 */
export const ADMIN_ROUTES_LOADER = new InjectionToken<AdminRoutesLoader>('ADMIN_ROUTES_LOADER', {
  providedIn: 'root',
  factory: () => () => Promise.resolve([{ path: '**', component: AdminPlaceholder }]),
});

export const adminRoute: Route = {
  path: 'admin',
  loadChildren: () => inject(ADMIN_ROUTES_LOADER)(),
};
