import type { Express, RequestHandler } from 'express';
import {
  isCityDetail,
  isCitySitemap,
  isLine,
  isSitemapIndex,
  isSlug,
  modeLabel,
} from '../app/content/public-types';
import {
  citySitemapEntries,
  sitemapIndexEntries,
  sitemapIndexXml,
  urlSetXml,
} from '../app/content/sitemap-xml';
import { projectLine } from '../app/content/line-geometry';
import { lineOgSvg } from '../app/content/og-image';
import { apiPath } from '../app/data/public-api.client';
import type { ApiReader } from './api-reader';
import type { WebServerConfig } from './config';
import type { MemoryLruPageCache } from './page-cache';

type MachineResult = { ok: true; body: string } | { ok: false; kind: 'not_found' | 'unavailable' };

const missing: MachineResult = { ok: false, kind: 'not_found' };
const unavailable: MachineResult = { ok: false, kind: 'unavailable' };
const xmlType = 'application/xml; charset=utf-8';

export function registerMachineFiles(
  app: Express,
  options: { config: WebServerConfig; reader: ApiReader; cache: MemoryLruPageCache },
): void {
  const { config, reader, cache } = options;

  function serve(
    contentType: string,
    build: (params: Readonly<Record<string, string>>) => Promise<MachineResult>,
    valid: (params: Readonly<Record<string, string>>) => boolean = () => true,
    maxAge = 3600,
  ): RequestHandler {
    return async (req, res, next) => {
      // Only single-segment string parameters reach the builders.
      const params: Record<string, string> = {};
      for (const [name, value] of Object.entries(req.params as Record<string, unknown>)) {
        if (typeof value === 'string') params[name] = value;
      }
      if (!valid(params)) {
        next();
        return;
      }
      const key = 'machine|' + req.path;
      const cached = await cache.get(key);
      let result: MachineResult;
      if (cached) {
        result = { ok: true, body: cached.body };
      } else {
        try {
          result = await build(params);
        } catch {
          result = unavailable;
        }
        if (result.ok) {
          await cache.set(
            key,
            { status: 200, contentType, body: result.body, storedAt: Date.now() },
            config.cacheTtlMs,
          );
        }
      }
      if (result.ok) {
        res
          .status(200)
          .set('Content-Type', contentType)
          .set('Cache-Control', `public, max-age=${maxAge}`)
          .send(result.body);
      } else if (result.kind === 'not_found') {
        res
          .status(404)
          .set('Cache-Control', 'no-store')
          .type('text/plain')
          .send('Sayfa bulunamadı');
      } else {
        res
          .status(503)
          .set('Retry-After', '120')
          .set('Cache-Control', 'no-store')
          .type('text/plain')
          .send('Veriler şu anda kullanılamıyor.');
      }
    };
  }

  // Express sends the same headers and suppresses these bodies for HEAD.
  app.get(
    '/sitemap.xml',
    serve(xmlType, async () => {
      const index = await reader.read('/sitemap', undefined, isSitemapIndex);
      if (!index.ok) return index;
      return {
        ok: true,
        body: sitemapIndexXml(config.canonicalOrigin, sitemapIndexEntries(index.data)),
      };
    }),
  );

  app.get(
    '/sitemaps/:file',
    serve(
      xmlType,
      async (params) => {
        const slug = (params['file'] ?? '').slice(0, -4);
        const city = await reader.read(
          apiPath('/cities/{slug}', { slug }),
          undefined,
          isCityDetail,
        );
        if (!city.ok) return city;
        if (city.data.is_sample) return missing;
        if (city.data.slug !== slug) return unavailable;
        const sitemap = await reader.read(
          apiPath('/cities/{slug}/sitemap', { slug }),
          undefined,
          isCitySitemap,
        );
        if (!sitemap.ok) return sitemap;
        if (sitemap.data.city !== slug) return unavailable;
        return {
          ok: true,
          body: urlSetXml(
            config.canonicalOrigin,
            citySitemapEntries(sitemap.data, {
              lastmod: city.data.lastmod,
              isSample: city.data.is_sample,
            }),
          ),
        };
      },
      (params) =>
        /^([a-z0-9]+(?:-[a-z0-9]+)*)\.xml$/.test(params['file'] ?? '') &&
        isSlug(params['file']?.slice(0, -4)),
    ),
  );

  app.get(
    '/.well-known/assetlinks.json',
    serve('application/json', async () => {
      if (config.androidCertFingerprints.length === 0) return missing;
      return {
        ok: true,
        body: JSON.stringify([
          {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: {
              namespace: 'android_app',
              package_name: 'app.inecekvar.mobile',
              sha256_cert_fingerprints: config.androidCertFingerprints,
            },
          },
        ]),
      };
    }),
  );

  app.get(
    '/.well-known/apple-app-site-association',
    serve('application/json', async () => {
      if (config.iosTeamId === null) return missing;
      return {
        ok: true,
        body: JSON.stringify({
          applinks: {
            details: [
              {
                appIDs: [`${config.iosTeamId}.app.inecekvar.mobile`],
                components: [{ '/': '/*/hat/*' }, { '/': '/*/durak/*' }],
              },
            ],
          },
        }),
      };
    }),
  );

  app.get(
    '/og/:city/hat/:file',
    serve(
      'image/svg+xml; charset=utf-8',
      async (params) => {
        const citySlug = params['city'] ?? '';
        const slug = (params['file'] ?? '').slice(0, -4);
        const city = await reader.read(
          apiPath('/cities/{slug}', { slug: citySlug }),
          undefined,
          isCityDetail,
        );
        if (!city.ok) return city;
        if (city.data.is_sample) return missing;
        if (city.data.slug !== citySlug) return unavailable;
        const line = await reader.read(
          apiPath('/lines/{slug}', { slug }),
          { city: citySlug },
          isLine,
        );
        if (!line.ok) return line;
        if (line.data.slug !== slug) return unavailable;
        return {
          ok: true,
          body: lineOgSvg({
            lineName: line.data.name,
            cityName: city.data.name,
            modeLabel: modeLabel(line.data.mode),
            sketch: projectLine(line.data.geometry.coordinates, line.data.stops, {
              width: 1200,
              height: 630,
              padding: 120,
            }),
          }),
        };
      },
      (params) =>
        isSlug(params['city']) &&
        (params['file'] ?? '').endsWith('.svg') &&
        isSlug(params['file']?.slice(0, -4)),
      86400,
    ),
  );
}
