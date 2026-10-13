import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID, RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { FACTS } from '../../../content/facts';
import { FAQ } from '../../../content/faq';
import { GUIDES } from '../../../content/guides';
import { STATIC_PAGES } from '../../../content/pages';
import { DEFAULT_PUBLIC_WEB_CONFIG, PUBLIC_WEB_CONFIG } from '../../public-config';
import { JsonLdService } from '../../seo/json-ld.service';
import { SeoService } from '../../seo/seo.service';
import { PageData } from '../page-data';
import { appRoutes } from '../../app.routes';
import { ContentPage } from './content.page';
import { ContentData, contentResolver, contentViewForPath } from './content-view';
import { ActivatedRouteSnapshot } from '@angular/router';

function render(path: string) {
  const view = contentViewForPath(path);
  const page: PageData<ContentData> = view
    ? { state: 'ok', content: view }
    : { state: 'not_found' };
  const resolved = new BehaviorSubject({ page });
  TestBed.configureTestingModule({
    imports: [ContentPage],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { data: resolved } },
      { provide: PLATFORM_ID, useValue: 'server' },
      { provide: RESPONSE_INIT, useValue: { status: 200 } },
      { provide: PUBLIC_WEB_CONFIG, useValue: DEFAULT_PUBLIC_WEB_CONFIG },
    ],
  });
  const fixture = TestBed.createComponent(ContentPage);
  fixture.detectChanges();
  return fixture;
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function jsonLd(): Record<string, unknown>[] {
  const document = TestBed.inject(DOCUMENT);
  return [...document.head.querySelectorAll('script[type="application/ld+json"]')].flatMap(
    (script) => {
      const data = JSON.parse(script.textContent ?? '') as Record<string, unknown>;
      expect(data['@context']).toBe('https://schema.org');
      const graph = data['@graph'];
      return Array.isArray(graph) ? (graph as Record<string, unknown>[]) : [data];
    },
  );
}

afterEach(() => {
  try {
    TestBed.inject(SeoService).reset();
    TestBed.inject(JsonLdService).clearAll();
  } catch {
    // Tests that never rendered a page have no providers to clean.
  }
  TestBed.resetTestingModule();
});

describe('ContentPage guides', () => {
  it.each(GUIDES.map((guide) => [guide.slug, guide.path] as const))(
    'renders %s with at least 600 words of text, headings, internal links and Article data',
    async (_slug, path) => {
      const fixture = render(path);
      await fixture.whenStable();
      const element = fixture.nativeElement as HTMLElement;
      const article = element.querySelector('article');
      expect(article).not.toBeNull();
      expect(words(article?.textContent ?? '')).toBeGreaterThanOrEqual(600);
      expect(element.querySelectorAll('h1')).toHaveLength(1);
      expect(element.querySelectorAll('h2').length).toBeGreaterThanOrEqual(4);
      expect(element.querySelectorAll('a[href]').length).toBeGreaterThanOrEqual(3);
      expect(element.querySelector('script')).toBeNull();
      const nodes = jsonLd();
      const articles = nodes.filter((node) => node['@type'] === 'Article');
      expect(articles).toHaveLength(1);
      expect(articles[0]?.['headline']).toBe(element.querySelector('h1')?.textContent);
      expect(String(articles[0]?.['url'])).toBe(DEFAULT_PUBLIC_WEB_CONFIG.canonicalOrigin + path);
      expect(nodes.filter((node) => node['@type'] === 'BreadcrumbList')).toHaveLength(1);
    },
  );

  it('prints no rendered link text that differs from the data', async () => {
    const fixture = render(GUIDES[0]?.path ?? '/');
    await fixture.whenStable();
    const links = [...(fixture.nativeElement as HTMLElement).querySelectorAll('a')];
    const element = fixture.nativeElement as HTMLElement;
    for (const link of links) {
      const href = link.getAttribute('href') ?? '';
      expect(href).toMatch(/^(\/|#|https:\/\/app\.inecekvar\.app)/);
      expect(link.textContent?.trim().length).toBeGreaterThan(0);
      // In-page links (skip link, table of contents) must land on an element of the page.
      if (href.startsWith('#')) {
        expect(element.querySelector(href), href).not.toBeNull();
      }
    }
    expect(element.querySelectorAll('nav[aria-label="İçindekiler"] a').length).toBeGreaterThan(2);
  });
});

describe('ContentPage faq', () => {
  it('renders the 15 questions and mirrors them one to one in FAQPage data', async () => {
    const fixture = render('/sss');
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const sections = [...element.querySelectorAll('section')];
    expect(sections).toHaveLength(15);
    const rendered = sections.map((section) => ({
      question: section.querySelector('h2')?.textContent ?? '',
      answer: section.querySelector('p')?.textContent ?? '',
    }));
    expect(rendered).toEqual(FAQ.map((item) => ({ question: item.question, answer: item.answer })));
    const pages = jsonLd().filter((node) => node['@type'] === 'FAQPage');
    expect(pages).toHaveLength(1);
    const entities = pages[0]?.['mainEntity'] as {
      '@type': string;
      name: string;
      acceptedAnswer: { '@type': string; text: string };
    }[];
    expect(entities).toHaveLength(15);
    expect(
      entities.map((entity) => ({ question: entity.name, answer: entity.acceptedAnswer.text })),
    ).toEqual(rendered);
  });
});

describe('ContentPage other pages', () => {
  it('renders the data page with Dataset data, the licence status and the export address', async () => {
    const fixture = render('/veri');
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain(FACTS.licence.statusLine);
    expect(element.querySelector('code')?.textContent).toBe(
      'https://api.inecekvar.app/v1/export/{sehir}/latest.geojson',
    );
    const dataset = jsonLd().filter((node) => node['@type'] === 'Dataset');
    expect(dataset).toHaveLength(1);
    expect(dataset[0]?.['license']).toBe(
      DEFAULT_PUBLIC_WEB_CONFIG.canonicalOrigin + '/veri-lisansi',
    );
  });

  it('renders the about page with the shared entity facts in JSON-LD', async () => {
    const fixture = render('/hakkinda');
    await fixture.whenStable();
    const nodes = jsonLd();
    for (const type of ['Organization', 'WebApplication', 'MobileApplication']) {
      const node = nodes.find((item) => item['@type'] === type);
      expect(node?.['name']).toBe(FACTS.name);
      expect(node?.['description']).toBe(FACTS.description);
    }
  });

  it('renders the KVKK draft status and the deletion page without server-side form controls', async () => {
    const kvkk = render('/kvkk-aydinlatma');
    await kvkk.whenStable();
    expect((kvkk.nativeElement as HTMLElement).querySelector('.status')?.textContent).toMatch(
      /Taslak/,
    );
    TestBed.inject(SeoService).reset();
    TestBed.resetTestingModule();
    const deletion = render('/hesap-silme');
    await deletion.whenStable();
    const element = deletion.nativeElement as HTMLElement;
    // The panel is client-only (ADR-0057): the server render carries the slot and its fallback.
    expect(element.querySelector('form, input, button, textarea')).toBeNull();
    expect(element.querySelector('.status')?.textContent).toMatch(/web silme panelinden/);
    expect(element.querySelector('iv-deletion-slot h2')?.textContent).toBe('Web üzerinden silme');
    expect(element.querySelector('[data-deletion-fallback]')?.textContent).toMatch(
      /JavaScript gerektirir/,
    );
  });

  it('renders the guide list on the index page', async () => {
    const fixture = render('/rehber');
    await fixture.whenStable();
    const links = (fixture.nativeElement as HTMLElement).querySelectorAll('.guides a');
    expect(links).toHaveLength(5);
  });

  it('renders an unknown guide as not found', async () => {
    const fixture = render('/rehber/yok');
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Sayfa bulunamadı');
  });
});

describe('content routes', () => {
  const routePaths = appRoutes.map((route) => route.path);

  it('registers every content page before the city routes', () => {
    const cityIndex = routePaths.indexOf(':sehir');
    for (const page of STATIC_PAGES) {
      const index = routePaths.indexOf(page.path.slice(1));
      expect(index, page.path).toBeGreaterThanOrEqual(0);
      expect(index, page.path).toBeLessThan(cityIndex);
    }
    const guideIndex = routePaths.indexOf('rehber/:slug');
    expect(guideIndex).toBeGreaterThanOrEqual(0);
    expect(guideIndex).toBeLessThan(cityIndex);
  });

  it('resolves a known slug and answers not found for an unknown one', () => {
    const snapshot = (slug: string | null, contentPath?: string) =>
      ({
        paramMap: { get: (name: string) => (name === 'slug' ? slug : null) },
        data: contentPath ? { contentPath } : {},
      }) as unknown as ActivatedRouteSnapshot;
    const run = (route: ActivatedRouteSnapshot) =>
      TestBed.runInInjectionContext(() => contentResolver(route, {} as never));
    expect(run(snapshot(GUIDES[0]?.slug ?? null))).toMatchObject({ state: 'ok' });
    expect(run(snapshot('..%2f'))).toEqual({ state: 'not_found' });
    expect(run(snapshot(null, '/sss'))).toMatchObject({ state: 'ok' });
    expect(run(snapshot(null))).toEqual({ state: 'not_found' });
  });
});
