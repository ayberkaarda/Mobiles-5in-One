/**
 * Shared pieces of the transactional email templates: HTML escaping and one minimal layout.
 * Every value that reaches the HTML part goes through {@link escapeHtml}, including links built
 * by the server, so a display name such as `<img src=x onerror=...>` arrives as inert text.
 */

const HTML_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
]);

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES.get(character) ?? character);
}

export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface EmailLink {
  readonly label: string;
  readonly href: string;
}

export interface EmailContent {
  readonly subject: string;
  readonly greetingName: string;
  /** Paragraphs before the links (plain text, escaped for HTML). */
  readonly intro: readonly string[];
  readonly links: readonly EmailLink[];
  /** Paragraphs after the links. */
  readonly outro: readonly string[];
}

/** Absolute link to a path of the web app; a token travels only in the URL fragment. */
export function appLink(origin: string, path: string, token?: string): string {
  const url = new URL(path, origin);
  if (typeof token === 'string') {
    url.hash = `token=${encodeURIComponent(token)}`;
  }
  return url.toString();
}

export function renderEmail(content: EmailContent): RenderedEmail {
  const greeting = `Merhaba ${content.greetingName},`;
  const text = [
    greeting,
    '',
    ...content.intro,
    '',
    ...content.links.map((link) => `${link.label}: ${link.href}`),
    '',
    ...content.outro,
    '',
    'Kadro',
  ].join('\n');

  const paragraph = (value: string): string =>
    `<p style="margin:0 0 16px">${escapeHtml(value)}</p>`;
  const button = (link: EmailLink): string =>
    `<p style="margin:0 0 16px"><a href="${escapeHtml(link.href)}" style="display:inline-block;padding:12px 20px;background:#0f7a3d;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600">${escapeHtml(link.label)}</a></p>`;

  const html = [
    '<!doctype html>',
    '<html lang="tr">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(content.subject)}</title></head>`,
    '<body style="margin:0;padding:24px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917;font-size:16px;line-height:1.5">',
    '<div style="max-width:520px;margin:0 auto;background:#ffffff;padding:24px;border-radius:8px">',
    paragraph(greeting),
    ...content.intro.map(paragraph),
    ...content.links.map(button),
    ...content.outro.map(paragraph),
    '<p style="margin:24px 0 0;color:#57534e">Kadro</p>',
    '</div>',
    '</body>',
    '</html>',
  ].join('');

  return { subject: content.subject, text, html };
}
