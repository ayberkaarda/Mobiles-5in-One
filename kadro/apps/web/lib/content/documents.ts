import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { type Block, countWords, parseBlocks } from './markdown';

/**
 * Loader of the site's content files (ADR-0080): `content/blog/*.mdx` and `content/legal/*.mdx`.
 * Files are read once per server process and validated: front matter against a schema, body
 * against the Markdown subset parser. A file name is the slug; a request path is only ever looked
 * up in the loaded list, never joined into a file path.
 */

export const WORDS_PER_MINUTE = 200;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Lower-case ASCII words joined by single hyphens. */
export function isSlug(text: string): boolean {
  return text.split('-').every((part) => /^[a-z0-9]+$/.test(part));
}

const frontMatterSchema = z
  .object({
    title: z.string().min(1).max(80),
    description: z.string().min(1).max(155),
    publishedAt: z.string().regex(DATE),
    modifiedAt: z.string().regex(DATE).optional(),
    tags: z.array(z.string().refine(isSlug)).max(8).optional(),
    sample: z.boolean().optional(),
  })
  .strict();

export interface ContentDocument {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  /** ISO calendar date, `YYYY-MM-DD`. */
  readonly publishedAt: string;
  readonly modifiedAt: string;
  readonly tags: readonly string[];
  /** Demonstration text of a portfolio project: pages show a visible sample notice. */
  readonly sample: boolean;
  readonly blocks: readonly Block[];
  readonly wordCount: number;
  /** Whole minutes at {@link WORDS_PER_MINUTE}, at least 1. */
  readonly readingMinutes: number;
}

export type ContentCollection = 'blog' | 'legal';

export function contentRoot(): string {
  return join(process.cwd(), 'content');
}

/** Splits `---` front matter from the body; values are JSON (strings, arrays, booleans). */
export function parseFrontMatter(source: string): { data: unknown; body: string } {
  const text = (source.startsWith('\uFEFF') ? source.slice(1) : source).replace(/\r\n?/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (match === null) {
    throw new Error('missing front matter');
  }
  const data: Record<string, unknown> = {};
  for (const line of (match[1] ?? '').split('\n')) {
    const entry = /^([A-Za-z][A-Za-z0-9]*):\s*(.+)$/.exec(line);
    if (entry === null) {
      throw new Error(`unsupported front matter line: ${line}`);
    }
    const key = entry[1] ?? '';
    if (key in data) {
      throw new Error(`duplicate front matter key: ${key}`);
    }
    Object.defineProperty(data, key, {
      value: JSON.parse(entry[2] ?? '') as unknown,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return { data, body: text.slice(match[0].length) };
}

export function parseDocument(slug: string, source: string): ContentDocument {
  const { data, body } = parseFrontMatter(source);
  const front = frontMatterSchema.parse(data);
  const blocks = parseBlocks(body);
  const wordCount = countWords(blocks);
  return {
    slug,
    title: front.title,
    description: front.description,
    publishedAt: front.publishedAt,
    modifiedAt: front.modifiedAt ?? front.publishedAt,
    tags: front.tags ?? [],
    sample: front.sample ?? false,
    blocks,
    wordCount,
    readingMinutes: Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE)),
  };
}

const cache = new Map<string, readonly ContentDocument[]>();

/** All documents of a collection, newest first (then by slug), loaded once per process. */
export function loadCollection(
  collection: ContentCollection,
  root: string = contentRoot(),
): readonly ContentDocument[] {
  const key = `${root}\n${collection}`;
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const directory = join(root, collection);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed collection names under the content root
  const names = readdirSync(directory)
    .filter((name) => name.endsWith('.mdx'))
    .sort();
  const documents = names.map((name) => {
    const slug = name.slice(0, -'.mdx'.length);
    if (!isSlug(slug)) {
      throw new Error(`content file name is not a slug: ${name}`);
    }
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- listed from the directory above
      return parseDocument(slug, readFileSync(join(directory, name), 'utf8'));
    } catch (error) {
      throw new Error(
        `${collection}/${name}: ${error instanceof Error ? error.message : 'invalid'}`,
        {
          cause: error,
        },
      );
    }
  });
  documents.sort((a, b) =>
    a.publishedAt === b.publishedAt
      ? a.slug.localeCompare(b.slug)
      : b.publishedAt.localeCompare(a.publishedAt),
  );
  cache.set(key, documents);
  return documents;
}

export function findDocument(
  collection: ContentCollection,
  slug: string,
): ContentDocument | undefined {
  return loadCollection(collection).find((document) => document.slug === slug);
}

/** Legal pages by the route they are served on (file name differs from the route for KVKK). */
export const LEGAL_ROUTES = {
  '/gizlilik': 'gizlilik',
  '/kvkk-aydinlatma': 'kvkk-aydinlatma',
} as const;

export type LegalPath = keyof typeof LEGAL_ROUTES;

export function legalDocument(path: LegalPath): ContentDocument {
  // eslint-disable-next-line security/detect-object-injection -- path is a key of the literal map
  const document = findDocument('legal', LEGAL_ROUTES[path]);
  if (document === undefined) {
    throw new Error(`legal content for ${path} is missing`);
  }
  return document;
}
