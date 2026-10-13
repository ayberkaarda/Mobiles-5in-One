import { mergeApplicationConfig } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { ADMIN_ROUTES_LOADER } from './app/admin-entry';
import { DELETION_PANEL_LOADER } from './app/deletion-entry';

// Only the browser entry knows the admin and deletion chunks; they load lazily when /admin or
// the panel of /hesap-silme opens (ADR-0041, ADR-0057).
const browserConfig = mergeApplicationConfig(appConfig, {
  providers: [
    {
      provide: ADMIN_ROUTES_LOADER,
      useValue: () => import('./app/admin/admin.routes').then((m) => m.adminRoutes),
    },
    {
      provide: DELETION_PANEL_LOADER,
      useValue: () => import('./app/deletion/deletion-panel').then((m) => m.DELETION_PANEL),
    },
  ],
});

bootstrapApplication(App, browserConfig).catch((err) => console.error(err));
