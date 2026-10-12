/**
 * Structured text for the static content pages. Pages are data, not HTML: the components render
 * these blocks with ordinary template bindings, so no markup string ever reaches the DOM.
 */
export type InlinePart =
  | string
  | { readonly to: string; readonly text: string }
  | { readonly app: string; readonly text: string };

export type Block =
  | { readonly kind: 'h2' | 'h3'; readonly text: string }
  | { readonly kind: 'p' | 'note'; readonly parts: readonly InlinePart[] }
  | { readonly kind: 'ul' | 'ol'; readonly items: readonly (readonly InlinePart[])[] };

export const h2 = (text: string): Block => ({ kind: 'h2', text });
export const h3 = (text: string): Block => ({ kind: 'h3', text });
export const p = (...parts: InlinePart[]): Block => ({ kind: 'p', parts });
export const note = (...parts: InlinePart[]): Block => ({ kind: 'note', parts });
export const ul = (...items: (InlinePart | InlinePart[])[]): Block => ({
  kind: 'ul',
  items: items.map((item) => (Array.isArray(item) ? item : [item])),
});
export const ol = (...items: (InlinePart | InlinePart[])[]): Block => ({
  kind: 'ol',
  items: items.map((item) => (Array.isArray(item) ? item : [item])),
});
export const to = (path: string, text: string): InlinePart => ({ to: path, text });
export const app = (path: string, text: string): InlinePart => ({ app: path, text });

export function inlineText(parts: readonly InlinePart[]): string {
  return parts.map((part) => (typeof part === 'string' ? part : part.text)).join('');
}

/** The text a reader sees for one block, one line per paragraph or list item. */
export function blockText(block: Block): string[] {
  switch (block.kind) {
    case 'h2':
    case 'h3':
      return [block.text];
    case 'p':
    case 'note':
      return [inlineText(block.parts)];
    case 'ul':
    case 'ol':
      return block.items.map((item) => inlineText(item));
  }
}

export function blocksText(blocks: readonly Block[]): string {
  return blocks.flatMap(blockText).join('\n');
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Every internal path and app path linked from the blocks. */
export function blockLinks(blocks: readonly Block[]): { to: string[]; app: string[] } {
  const internal: string[] = [];
  const application: string[] = [];
  const visit = (parts: readonly InlinePart[]): void => {
    for (const part of parts) {
      if (typeof part === 'string') continue;
      if ('to' in part) internal.push(part.to);
      else application.push(part.app);
    }
  };
  for (const block of blocks) {
    if (block.kind === 'p' || block.kind === 'note') visit(block.parts);
    else if (block.kind === 'ul' || block.kind === 'ol') block.items.forEach(visit);
  }
  return { to: internal, app: application };
}
