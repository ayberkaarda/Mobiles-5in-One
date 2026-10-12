import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { appRoutes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { PUBLIC_WEB_CONFIG, publicWebConfigFactory } from './public-config';

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: PUBLIC_WEB_CONFIG, useFactory: publicWebConfigFactory },
    provideClientHydration(withEventReplay()),
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
  ],
};
