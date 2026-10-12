import { mergeApplicationConfig } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { ADMIN_ROUTES_LOADER } from './app/admin-entry';

// Only the browser entry knows the admin chunk; it loads lazily when /admin opens (ADR-0041).
const browserConfig = mergeApplicationConfig(appConfig, {
  providers: [
    {
      provide: ADMIN_ROUTES_LOADER,
      useValue: () => import('./app/admin/admin.routes').then((m) => m.adminRoutes),
    },
  ],
});

bootstrapApplication(App, browserConfig).catch((err) => console.error(err));
