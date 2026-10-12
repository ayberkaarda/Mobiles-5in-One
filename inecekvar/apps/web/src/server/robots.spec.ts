// @vitest-environment node
import { loadWebServerConfig } from './config';
import { robotsTxt } from './robots';

describe('robots text', () => {
  it('allows public production pages and advertises the canonical sitemap', () => {
    const config = loadWebServerConfig({ IV_WEB_CANONICAL_ORIGIN: 'https://routes.example' });
    expect(robotsTxt(config)).toBe(
      'User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: https://routes.example/sitemap.xml\n',
    );
  });

  it.each(['local', 'test'])('disallows indexing in %s', (env) => {
    expect(robotsTxt(loadWebServerConfig({ INECEKVAR_ENV: env }))).toBe(
      'User-agent: *\nDisallow: /\n',
    );
  });
});
