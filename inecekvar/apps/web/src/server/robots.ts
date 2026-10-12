import type { WebServerConfig } from './config';

export function robotsTxt(config: WebServerConfig): string {
  return config.robotsIndexable
    ? `User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${config.canonicalOrigin}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n';
}
