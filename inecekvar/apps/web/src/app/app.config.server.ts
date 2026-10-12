import { mergeApplicationConfig, ApplicationConfig, CSP_NONCE } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { NONCE_PLACEHOLDER } from './csp-nonce-placeholder';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    { provide: CSP_NONCE, useValue: NONCE_PLACEHOLDER },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
