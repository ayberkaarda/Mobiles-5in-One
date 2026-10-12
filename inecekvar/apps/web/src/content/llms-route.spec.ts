// @vitest-environment node
import { createWebApp, type PageRenderer } from '../server/app';
import { loadWebServerConfig } from '../server/config';
import { closeServers, httpRequest, startApp } from '../server/test-helpers';
import { FACTS } from './facts';
import { llmsFullTxt, llmsTxt } from './llms';
import { indexablePagePaths } from './llms-route';

afterEach(async () => {
  await closeServers();
});

async function fixture() {
  const apiFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }));
  const config = loadWebServerConfig({ INECEKVAR_ENV: 'test' });
  const render = vi.fn<PageRenderer>(async () => null);
  const port = await startApp(createWebApp({ config, apiFetch, render }));
  return { port, apiFetch, render, origin: config.canonicalOrigin };
}

describe('llms files', () => {
  it('serves /llms.txt and /llms-full.txt as UTF-8 plain text built from the facts', async () => {
    const { port, render, apiFetch, origin } = await fixture();
    const short = await httpRequest(port, { path: '/llms.txt' });
    const full = await httpRequest(port, { path: '/llms-full.txt' });
    for (const result of [short, full]) {
      expect(result.status).toBe(200);
      expect(result.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect(result.headers['cache-control']).toBe('public, max-age=3600');
      expect(result.headers['x-content-type-options']).toBe('nosniff');
      expect(result.body).toContain(FACTS.tagline);
    }
    expect(short.body).toBe(llmsTxt(origin));
    expect(full.body).toBe(llmsFullTxt(origin));
    expect(render).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('serves a pages sitemap without noindex pages, with the content date as lastmod', async () => {
    const { port, origin } = await fixture();
    const result = await httpRequest(port, { path: '/sitemap-pages.xml' });
    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toBe('application/xml; charset=utf-8');
    expect(result.body).toContain(`<loc>${origin}/sss</loc>`);
    expect(result.body).toContain('<lastmod>2026-10-12T00:00:00Z</lastmod>');
    expect(result.body).not.toContain('/kvkk-aydinlatma');
    expect(result.body).not.toContain('/iletisim');
    expect(indexablePagePaths()).toContain('/rehber/hat-bilgisi-nasil-dogrulanir');
  });

  it('does not answer POST', async () => {
    const { port } = await fixture();
    const result = await httpRequest(port, { path: '/llms.txt', method: 'POST' });
    expect(result.status).toBe(405);
  });
});
