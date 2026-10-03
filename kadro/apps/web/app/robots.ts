import { loadWebEnv } from '@kadro/config';
import type { MetadataRoute } from 'next';
import { connection } from 'next/server';

/**
 * `/robots.txt`. Public pages stay crawlable; the API and the account surfaces (email-link pages,
 * the invite page) are not for crawlers (they also answer with `noindex`, see
 * `lib/server/security-headers.ts`). The sitemap origin is the configured `WEB_ORIGIN`, the same
 * source as `app/sitemap.ts`, so the file is built per request like the sitemap.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  const origin = loadWebEnv().WEB_ORIGIN;
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/admin/',
        '/mac/',
        '/giris',
        '/sifremi-unuttum',
        '/sifre-sifirla',
        '/e-posta-dogrula',
        '/hesap-silme',
      ],
    },
    sitemap: new URL('/sitemap.xml', origin).toString(),
  };
}
