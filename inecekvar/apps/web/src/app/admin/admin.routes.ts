import type { Provider } from '@angular/core';
import type { Routes } from '@angular/router';
import {
  AccountApi,
  API_BASE_URL,
  ApiClient,
  AUTH_STRATEGY,
  AuthApi,
  CookieAuthStrategy,
  SessionStore,
} from '@inecekvar/data-access';
import { AdminApi } from './admin-api';
import { AdminSession } from './admin-session';
import { ConfirmService } from './dialogs/confirm.service';
import { guestGuard, roleGuard, staffGuard } from './guards';
import { AuditPage } from './pages/audit.page';
import { ExportPage } from './pages/export.page';
import { QueuePage } from './pages/queue.page';
import { SignInPage } from './pages/sign-in.page';
import { TotpPage } from './pages/totp.page';
import { UsersPage } from './pages/users.page';
import { VersionsPage } from './pages/versions.page';
import { QueueStore } from './queue/queue.store';
import { AdminShellComponent } from './shell/admin-shell.component';
import { StepUpService } from './step-up/step-up.service';

/** Same-origin API path behind the reverse proxy (ops/Caddyfile), so the cookie stays first-party. */
export const ADMIN_API_BASE = '/api/v1';

/**
 * The admin area's own instances of the shared client: cookie strategy only (never bearer),
 * created in this route's injector, so nothing of it exists before `/admin` is opened.
 */
export const ADMIN_PROVIDERS: Provider[] = [
  { provide: API_BASE_URL, useValue: ADMIN_API_BASE },
  CookieAuthStrategy,
  { provide: AUTH_STRATEGY, useExisting: CookieAuthStrategy },
  ApiClient,
  AuthApi,
  AccountApi,
  SessionStore,
  AdminApi,
  AdminSession,
  StepUpService,
  ConfirmService,
  QueueStore,
];

const adminOnly = roleGuard(['admin']);

export const adminRoutes: Routes = [
  {
    path: '',
    component: AdminShellComponent,
    providers: ADMIN_PROVIDERS,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'kuyruk' },
      { path: 'giris', canActivate: [guestGuard], component: SignInPage },
      { path: 'kuyruk', canActivate: [staffGuard], component: QueuePage },
      { path: 'surumler', canActivate: [staffGuard], component: VersionsPage },
      { path: 'dogrulama', canActivate: [staffGuard], component: TotpPage },
      { path: 'kullanicilar', canActivate: [staffGuard, adminOnly], component: UsersPage },
      { path: 'disa-aktar', canActivate: [staffGuard, adminOnly], component: ExportPage },
      { path: 'denetim', canActivate: [staffGuard, adminOnly], component: AuditPage },
      { path: '**', redirectTo: 'kuyruk' },
    ],
  },
];
