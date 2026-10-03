/**
 * Parser for the Markdown subset the site's content files use (ADR-0080). The files carry the
 * `.mdx` extension but contain no JSX, imports or expressions: only front matter, headings,
 * paragraphs, lists, one-line quotes, tables, links, bold and code spans. Parsing yields plain
 * data; `components/content/markdown-view.tsx` turns it into React elements, so no HTML string is
 * ever built or injected. Anything outside the subset throws, which fails the content test
 * instead of rendering something unreviewed.
 */

export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'strong'; readonly children: readonly Inline[] }
  | { readonly kind: 'link'; readonly href: string; readonly children: readonly Inline[] };

export type Block =
  | { readonly kind: 'heading'; readonly level: 2 | 3; readonly id: string; readonly text: string }
  | { readonly kind: 'paragraph'; readonly children: readonly Inline[] }
  | { readonly kind: 'quote'; readonly children: readonly Inline[] }
  | {
      readonly kind: 'list';
      readonly ordered: boolean;
      readonly items: readonly (readonly Inline[])[];
    }
  | {
      readonly kind: 'table';
      readonly header: readonly (readonly Inline[])[];
      readonly rows: readonly (readonly (readonly Inline[])[])[];
    };

const TURKISH_FOLD: ReadonlyMap<string, string> = new Map([
  ['ç', 'c'],
  ['ğ', 'g'],
  ['ı', 'i'],
  ['ö', 'o'],
  ['ş', 's'],
  ['ü', 'u'],
]);

/** URL fragment for a heading: lower case, Turkish letters folded, words joined by hyphens. */
export function headingSlug(text: string): string {
  const folded = text
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşü]/g, (letter) => TURKISH_FOLD.get(letter) ?? letter)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return folded === '' ? 'bolum' : folded;
}

/** True when the text holds an ASCII control character (U+0000 to U+001F, U+007F). */
function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** A link target the renderer may emit: a site path or an `https:` URL, nothing else. */
export function isSafeHref(href: string): boolean {
  if (href.startsWith('/')) {
    return !href.startsWith('//') && !href.includes('\\') && !hasControlCharacter(href);
  }
  try {
    const url = new URL(href);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
const STRAY_SYNTAX = /[<>{}]|\*\*|\]\(|`/;

export function parseInline(source: string): Inline[] {
  const nodes: Inline[] = [];
  let last = 0;
  for (const match of source.matchAll(INLINE)) {
    if (match.index > last) {
      nodes.push({ kind: 'text', text: source.slice(last, match.index) });
    }
    const [, code, strong, label, href] = match;
    if (code !== undefined) {
      nodes.push({ kind: 'code', text: code });
    } else if (strong !== undefined) {
      nodes.push({ kind: 'strong', children: parseInline(strong) });
    } else if (label !== undefined && href !== undefined) {
      if (!isSafeHref(href)) {
        throw new Error(`unsafe link target: ${href}`);
      }
      nodes.push({ kind: 'link', href, children: parseInline(label) });
    }
    last = match.index + match[0].length;
  }
  if (last < source.length) {
    nodes.push({ kind: 'text', text: source.slice(last) });
  }
  for (const node of nodes) {
    if (node.kind === 'text' && STRAY_SYNTAX.test(node.text)) {
      throw new Error(`unsupported inline syntax: ${source.slice(0, 80)}`);
    }
  }
  return nodes;
}

/** Plain text of inline nodes (reading time, word counts). */
export function inlineText(nodes: readonly Inline[]): string {
  return nodes
    .map((node) =>
      node.kind === 'text' || node.kind === 'code' ? node.text : inlineText(node.children),
    )
    .join('');
}

/** Cells of one table row; a pipe inside a code span does not split the cell. */
function splitRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
    throw new Error(`malformed table row: ${line.slice(0, 80)}`);
  }
  const cells: string[] = [];
  let current = '';
  let inCode = false;
  for (const char of trimmed.slice(1, -1)) {
    if (char === '`') {
      inCode = !inCode;
    }
    if (char === '|' && !inCode) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

/** The `| --- | :---: |` row under a table header. */
function isSeparatorRow(line: string): boolean {
  try {
    return splitRow(line).every((cell) => /^:?-{3,}:?$/.test(cell));
  } catch {
    return false;
  }
}

function startsBlock(line: string): boolean {
  return /^(#{1,6}\s|>\s|- |\d+\.\s|\|)/.test(line) || line.trim() === '';
}

export function parseBlocks(body: string): Block[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  const usedIds = new Map<string, number>();
  const lineAt = (position: number): string => lines.at(position) ?? '';
  let index = 0;

  while (index < lines.length) {
    const line = lineAt(index);
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading !== null) {
      const level = heading[1]?.length ?? 0;
      if (level !== 2 && level !== 3) {
        throw new Error(`heading level ${level} is not allowed: ${line}`);
      }
      const text = heading[2] ?? '';
      const base = headingSlug(text);
      const seen = usedIds.get(base) ?? 0;
      usedIds.set(base, seen + 1);
      blocks.push({ kind: 'heading', level, id: seen === 0 ? base : `${base}-${seen + 1}`, text });
      index += 1;
      continue;
    }
    if (line.startsWith('> ')) {
      const quoted: string[] = [];
      while (index < lines.length && lineAt(index).startsWith('> ')) {
        quoted.push(lineAt(index).slice(2).trim());
        index += 1;
      }
      blocks.push({ kind: 'quote', children: parseInline(quoted.join(' ')) });
      continue;
    }
    const ordered = /^\d+\.\s/.test(line);
    if (ordered || line.startsWith('- ')) {
      const items: Inline[][] = [];
      const pattern = ordered ? /^\d+\.\s+(.*)$/ : /^- (.*)$/;
      while (index < lines.length) {
        const item = pattern.exec(lineAt(index));
        if (item === null) {
          break;
        }
        items.push(parseInline(item[1] ?? ''));
        index += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    if (line.startsWith('|')) {
      const header = splitRow(line);
      if (!isSeparatorRow(lineAt(index + 1))) {
        throw new Error(`table without separator row: ${line.slice(0, 80)}`);
      }
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lineAt(index).startsWith('|')) {
        const cells = splitRow(lineAt(index));
        if (cells.length !== header.length) {
          throw new Error(`table row has ${cells.length} cells, expected ${header.length}`);
        }
        rows.push(cells);
        index += 1;
      }
      blocks.push({
        kind: 'table',
        header: header.map(parseInline),
        rows: rows.map((row) => row.map(parseInline)),
      });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && !startsBlock(lineAt(index))) {
      paragraph.push(lineAt(index).trim());
      index += 1;
    }
    if (paragraph.length === 0) {
      throw new Error(`unsupported block: ${line.slice(0, 80)}`);
    }
    blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join(' ')) });
  }
  return blocks;
}

/** Words in the rendered text of the blocks (headings included). */
export function countWords(blocks: readonly Block[]): number {
  const texts = blocks.flatMap((block): string[] => {
    switch (block.kind) {
      case 'heading':
        return [block.text];
      case 'paragraph':
      case 'quote':
        return [inlineText(block.children)];
      case 'list':
        return block.items.map(inlineText);
      case 'table':
        return [...block.header, ...block.rows.flat()].map(inlineText);
    }
  });
  return texts
    .join(' ')
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}
