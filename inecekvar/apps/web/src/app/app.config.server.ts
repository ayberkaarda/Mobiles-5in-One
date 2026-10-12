import {
  mergeApplicationConfig,
  ApplicationConfig,
  CSP_NONCE,
  inject,
  provideAppInitializer,
  TransferState,
} from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { NONCE_PLACEHOLDER } from './csp-nonce-placeholder';
import { loadWebServerConfig } from '../server/config';
import { API_INTERNAL_BASE_URL } from './data/api-internal-base-url';
import { PUBLIC_CONFIG_STATE_KEY, PUBLIC_WEB_CONFIG, PublicWebConfig } from './public-config';

const webConfig = loadWebServerConfig(process.env);
const publicConfig: PublicWebConfig = {
  canonicalOrigin: webConfig.canonicalOrigin,
  apiPublicBaseUrl: webConfig.apiPublicBaseUrl,
  appStoreId: webConfig.appStoreId,
};

const serverConfig: ApplicationConfig = {
  providers: [
    { provide: PUBLIC_WEB_CONFIG, useValue: publicConfig },
    { provide: API_INTERNAL_BASE_URL, useValue: webConfig.apiInternalUrl },
    provideAppInitializer(() => {
      inject(TransferState).set(PUBLIC_CONFIG_STATE_KEY, inject(PUBLIC_WEB_CONFIG));
    }),
    provideServerRendering(withRoutes(serverRoutes)),
    { provide: CSP_NONCE, useValue: NONCE_PLACEHOLDER },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
