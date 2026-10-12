import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, RouteReuseStrategy } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { Capacitor } from '@capacitor/core';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular';
import { provideDataAccess } from '@inecekvar/data-access';
import { apiBaseFor, environment } from '../environments/environment';
import { appRoutes } from './app.routes';
import { LanguageService } from './core/language.service';
import { bootstrapSession } from './core/session-bootstrap';
import { ThemeService } from './core/theme.service';
import { provideAppI18n } from './i18n/i18n';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideIonicAngular({}),
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideRouter(appRoutes),
    provideAppI18n(),
    provideDataAccess({
      apiBase: apiBaseFor(environment, Capacitor.isNativePlatform()),
      tilesBase: environment.tilesBase,
    }),
    // Restore language and theme before the first render so nothing flashes; take a magic-link
    // token out of the address bar before the router reads the URL.
    provideAppInitializer(() => {
      inject(ThemeService);
      bootstrapSession();
      return inject(LanguageService).init();
    }),
    // PWA shell caching; off in development so the dev server always serves fresh code.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
