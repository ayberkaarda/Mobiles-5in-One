import { blockLinks, blocksText, wordCount } from './blocks';
import { FACTS } from './facts';
import { FAQ } from './faq';
import { GUIDES } from './guides';
import { llmsFullTxt, llmsTxt } from './llms';
import { OPEN_PAGES, STATIC_PAGES } from './pages';
import { contentPaths, MACHINE_PATHS } from './site-paths';
import { clampText, DESCRIPTION_MAX, pageTitle, TITLE_MAX } from '../app/seo/seo';
import { homeSeo } from '../app/home/home';

const origin = 'https://inecekvar.app';
// The CI banned-word expression.
// Written in pieces so that this file does not trip the repository grep itself.
const banned = new RegExp(
  [
    ['cla', 'ude'],
    ['cod', 'ex'],
    ['g', 'pt'],
    ['gener', 'ated'],
    ['orchest', 'rat'],
    ['to', 'do'],
    ['fix', 'me'],
    ['lo', 'rem'],
    ['your', '_'],
  ]
    .map((parts) => parts.join(''))
    .join('|'),
  'i',
);

function allTexts(): string[] {
  return [
    ...GUIDES.flatMap((guide) => [
      guide.h1,
      guide.title,
      guide.description,
      blocksText(guide.blocks),
    ]),
    ...STATIC_PAGES.flatMap((page) => [
      page.h1,
      page.title,
      page.description,
      page.status ?? '',
      blocksText(page.blocks),
    ]),
    ...FAQ.flatMap((item) => [item.question, item.answer]),
    llmsTxt(origin),
    llmsFullTxt(origin),
    ...Object.values(FACTS).flatMap((value) => (typeof value === 'string' ? [value] : [])),
  ];
}

describe('guides', () => {
  it('are the five planned guides with unique slugs', () => {
    expect(GUIDES).toHaveLength(5);
    expect(new Set(GUIDES.map((guide) => guide.slug)).size).toBe(5);
    for (const guide of GUIDES) {
      expect(guide.path).toBe(`/rehber/${guide.slug}`);
      expect(guide.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it.each(GUIDES.map((guide) => [guide.slug, guide] as const))(
    '%s has at least 600 words, an answer-first opening and headings',
    (_slug, guide) => {
      const words = wordCount(guide.h1 + '\n' + blocksText(guide.blocks));
      expect(words).toBeGreaterThanOrEqual(600);
      expect(guide.blocks[0]?.kind).toBe('p');
      expect(guide.blocks.filter((block) => block.kind === 'h2').length).toBeGreaterThanOrEqual(4);
      const first = guide.blocks[0];
      const opening = first ? wordCount(blocksText([first])) : 0;
      expect(opening).toBeGreaterThanOrEqual(25);
      expect(opening).toBeLessThanOrEqual(110);
    },
  );

  it('state no fare number: money amounts never appear in the prose', () => {
    for (const guide of GUIDES) {
      expect(blocksText(guide.blocks)).not.toMatch(/(?:₺|\bTL\b|\blira\b)\s*\d|\d\s*(?:₺|\bTL\b)/i);
    }
  });

  it('name no real operator', () => {
    const text = GUIDES.map((guide) => blocksText(guide.blocks)).join('\n');
    expect(text).not.toMatch(/\b(İETT|IETT|Metrobüs|Marmaray|İzulaş|EGO)\b/);
  });
});

describe('faq', () => {
  it('has exactly 15 pairs with distinct questions and plain answers', () => {
    expect(FAQ).toHaveLength(15);
    expect(new Set(FAQ.map((item) => item.question)).size).toBe(15);
    for (const item of FAQ) {
      expect(item.question.trim().endsWith('?')).toBe(true);
      expect(wordCount(item.answer)).toBeGreaterThanOrEqual(12);
      expect(item.answer).not.toMatch(/[<>]/);
    }
  });
});

describe('metadata', () => {
  const entries = [
    ...GUIDES.map((guide) => ({
      path: guide.path,
      title: guide.title,
      description: guide.description,
    })),
    ...STATIC_PAGES.map((page) => ({
      path: page.path,
      title: page.title,
      description: page.description,
    })),
  ];

  it.each(entries.map((entry) => [entry.path, entry] as const))(
    '%s has a title within 60 characters and a description within 155',
    (_path, entry) => {
      const title = pageTitle(entry.title);
      expect(Array.from(title).length).toBeLessThanOrEqual(TITLE_MAX);
      expect(title.endsWith(`| ${FACTS.name}`)).toBe(true);
      expect(title).not.toContain('…');
      expect(Array.from(entry.description).length).toBeLessThanOrEqual(DESCRIPTION_MAX);
      expect(clampText(entry.description, DESCRIPTION_MAX)).toBe(entry.description);
      expect(Array.from(entry.description).length).toBeGreaterThanOrEqual(60);
    },
  );

  it('has unique titles and descriptions', () => {
    expect(new Set(entries.map((entry) => entry.title)).size).toBe(entries.length);
    expect(new Set(entries.map((entry) => entry.description)).size).toBe(entries.length);
  });
});

describe('links and routes', () => {
  const known = new Set<string>([...contentPaths(), ...MACHINE_PATHS]);
  const blocks = [
    ...GUIDES.flatMap((guide) => guide.blocks),
    ...STATIC_PAGES.flatMap((page) => page.blocks),
  ];

  it('every internal link resolves to a registered content route', () => {
    const links = blockLinks(blocks).to;
    expect(links.length).toBeGreaterThan(20);
    for (const link of links) {
      expect(known.has(link), link).toBe(true);
    }
  });

  it('every guide is linked from another page', () => {
    for (const guide of GUIDES) {
      const fromGuide = GUIDES.some(
        (other) => other.slug !== guide.slug && blockLinks(other.blocks).to.includes(guide.path),
      );
      const fromStatic = STATIC_PAGES.some((page) =>
        blockLinks(page.blocks).to.includes(guide.path),
      );
      expect(fromGuide || fromStatic, guide.path).toBe(true);
    }
  });

  it('every guide links to the city list or the FAQ and has at least three links', () => {
    for (const guide of GUIDES) {
      const links = blockLinks(guide.blocks).to;
      expect(links.includes('/') || links.includes('/sss'), guide.path).toBe(true);
      expect(links.length, guide.path).toBeGreaterThanOrEqual(3);
    }
  });

  it('app links are root paths', () => {
    for (const link of blockLinks(blocks).app) {
      expect(link.startsWith('/')).toBe(true);
    }
  });
});

describe('text quality', () => {
  it('has no banned or placeholder words in any visible text', () => {
    for (const text of allTexts()) {
      expect(text).not.toMatch(banned);
    }
  });

  it('keeps Turkish characters intact', () => {
    const text = allTexts().join('\n');
    for (const letter of ['ç', 'ğ', 'ı', 'ö', 'ş', 'ü', 'İ']) {
      expect(text).toContain(letter);
    }
    expect(text).not.toMatch(/�|Ã.|Ä.|Å.|&#\d+;|&[a-z]+;/);
    expect(text.normalize('NFC')).toBe(text);
  });

  it('has no double spaces or edge spaces inside a guide paragraph', () => {
    for (const guide of GUIDES) {
      for (const line of blocksText(guide.blocks).split('\n')) {
        expect(line, line).toBe(line.trim());
        expect(line, line).not.toMatch(/ {2,}/);
      }
    }
  });
});

describe('entity facts', () => {
  it('home metadata uses the shared description', () => {
    expect(homeSeo().description).toBe(FACTS.description);
  });

  it('llms.txt and llms-full.txt carry the same name, tagline, description and licence status', () => {
    for (const text of [llmsTxt(origin), llmsFullTxt(origin)]) {
      expect(text.startsWith(`# ${FACTS.name}\n`)).toBe(true);
      expect(text).toContain(FACTS.tagline);
      expect(text).toContain(FACTS.description);
      expect(text).toContain(FACTS.licence.statusLine);
      for (const city of FACTS.targetCities) {
        expect(text).toContain(city);
      }
    }
    expect(llmsFullTxt(origin).length).toBeGreaterThan(llmsTxt(origin).length);
  });

  it('llms files link only to registered routes and machine files', () => {
    const known = new Set<string>([...contentPaths(), ...MACHINE_PATHS]);
    for (const text of [llmsTxt(origin), llmsFullTxt(origin)]) {
      const matches = [...text.matchAll(/\]\(https:\/\/inecekvar\.app([^)]*)\)/g)];
      expect(matches.length).toBeGreaterThan(10);
      for (const match of matches) {
        expect(known.has(match[1] ?? ''), match[1]).toBe(true);
      }
    }
  });

  it('about, FAQ and the data pages use the shared description and licence status', () => {
    const find = (path: string) => STATIC_PAGES.find((page) => page.path === path);
    expect(find('/hakkinda')?.description).toContain(FACTS.description);
    expect(FAQ[0]?.answer).toContain(FACTS.description);
    expect(find('/veri-lisansi')?.status).toBe(FACTS.licence.statusLine);
    expect(find('/veri')?.status).toBe(FACTS.licence.statusLine);
  });
});

describe('legal and honesty rules', () => {
  const find = (path: string) => STATIC_PAGES.find((page) => page.path === path);

  it('marks the KVKK text as a draft and keeps it out of the index', () => {
    const page = find('/kvkk-aydinlatma');
    expect(page?.status).toMatch(/Taslak/);
    expect(page?.h1).toMatch(/taslak/);
    expect(page?.index).toBe(false);
  });

  it('invents no registration numbers, addresses or contact addresses', () => {
    const text = allTexts().join('\n');
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    expect(text).not.toMatch(/\bMERSİS\s*(No|numarası)?\s*:?\s*\d/i);
    expect(text).not.toMatch(/\b\d{10,16}\b/);
    expect(text).not.toMatch(/\+?90\s?\(?\d{3}\)?\s?\d{3}/);
  });

  it('says the web deletion flow does not exist and shows no form', () => {
    const page = find('/hesap-silme');
    expect(page?.status).toMatch(/silme formu yoktur/);
    expect(blocksText(page?.blocks ?? [])).toMatch(/uygulanmamıştır/);
  });

  it('says the contact channel is being set up', () => {
    expect(find('/iletisim')?.status).toBe(FACTS.contact.statusLine);
  });

  it('states the licence is proposed and approval is pending', () => {
    expect(FACTS.licence.statusLine).toMatch(/önerilmiştir/);
    expect(FACTS.licence.statusLine).toMatch(/hukuki onay bekleniyor/);
    expect(FACTS.licence.statusLine).toMatch(/henüz verilmiş bir lisans yok/);
  });

  it('lists the terms of use as open work because no draft exists', () => {
    expect(OPEN_PAGES.map((page) => page.path)).toEqual(['/kullanim-kosullari']);
    expect(STATIC_PAGES.some((page) => page.path === '/kullanim-kosullari')).toBe(false);
  });

  it('keeps the trim, retention and grace numbers aligned with the ADRs', () => {
    expect(FACTS.trace.trimMetres).toBe(200);
    expect(FACTS.trace.retentionDays).toBe(30);
    expect(FACTS.deletion.graceDays).toBe(7);
    expect(allTexts().join('\n')).toMatch(/200 metre/);
  });
});
