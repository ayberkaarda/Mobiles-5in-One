import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, RouteReuseStrategy } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular';
import { appRoutes } from './app.routes';
import { LanguageService } from './core/language.service';
import { ThemeService } from './core/theme.service';
import { provideAppI18n } from './i18n/i18n';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideIonicAngular({}),
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideRouter(appRoutes),
    provideAppI18n(),
    // Restore language and theme before the first render so nothing flashes.
    provideAppInitializer(() => {
      inject(ThemeService);
      return inject(LanguageService).init();
    }),
    // PWA shell caching; off in development so the dev server always serves fresh code.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
