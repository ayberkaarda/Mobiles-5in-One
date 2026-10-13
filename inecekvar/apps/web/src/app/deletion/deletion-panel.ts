import type { Provider } from '@angular/core';
import {
  AccountApi,
  API_BASE_URL,
  ApiClient,
  AUTH_STRATEGY,
  AuthApi,
  CookieAuthStrategy,
  SessionStore,
} from '@inecekvar/data-access';
import type { DeletionPanelModule } from '../deletion-entry';
import { DeletionPanelComponent } from './deletion-panel.component';

/** Same-origin API path behind the reverse proxy, so the session cookie stays first-party. */
export const DELETION_API_BASE = '/api/v1';

/**
 * The panel's own instances of the shared client, cookie strategy only (never bearer), created
 * in a child injector when the panel opens; nothing of it exists in the public page before.
 */
export const DELETION_PROVIDERS: Provider[] = [
  { provide: API_BASE_URL, useValue: DELETION_API_BASE },
  CookieAuthStrategy,
  { provide: AUTH_STRATEGY, useExisting: CookieAuthStrategy },
  ApiClient,
  AuthApi,
  AccountApi,
  SessionStore,
];

export const DELETION_PANEL: DeletionPanelModule = {
  component: DeletionPanelComponent,
  providers: DELETION_PROVIDERS,
};
