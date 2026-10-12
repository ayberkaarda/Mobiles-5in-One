import { type EnvironmentProviders, inject, makeEnvironmentProviders } from '@angular/core';
import { AUTH_STRATEGY } from './auth/auth-strategy';
import { BearerAuthStrategy } from './auth/bearer-auth.strategy';
import { CookieAuthStrategy } from './auth/cookie-auth.strategy';
import { CapacitorSecureTokenStore, SECURE_TOKEN_STORE } from './auth/secure-token-store';
import { API_BASE_URL, IS_NATIVE_PLATFORM, TILES_BASE_URL } from './config';

export interface DataAccessConfig {
  apiBase: string;
  tilesBase: string;
}

/**
 * API base, tiles base and the auth strategy for this runtime: bearer inside the Capacitor
 * shell (refresh token in Keychain or Keystore), cookie plus CSRF on the web and the PWA.
 */
export function provideDataAccess(config: DataAccessConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: API_BASE_URL, useValue: config.apiBase },
    { provide: TILES_BASE_URL, useValue: config.tilesBase },
    { provide: SECURE_TOKEN_STORE, useFactory: () => new CapacitorSecureTokenStore() },
    {
      provide: AUTH_STRATEGY,
      useFactory: () =>
        inject(IS_NATIVE_PLATFORM) ? inject(BearerAuthStrategy) : inject(CookieAuthStrategy),
    },
  ]);
}
