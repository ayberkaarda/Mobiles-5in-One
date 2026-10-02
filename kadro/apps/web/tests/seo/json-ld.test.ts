import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JsonLd, JsonLdScript, serializeJsonLd } from '../../components/seo/json-ld';
import { NONCE_HEADER } from '../../lib/server/security-headers';

/**
 * JSON-LD helper (ADR-0055): structured data is rendered as React children of a
 * `<script type="application/ld+json">` element, never through `dangerouslySetInnerHTML`, and
 * serialized so no value can end the element, open an HTML comment or break a line in a script.
 */

const requestHeaders = new Headers();
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(requestHeaders),
}));

const HOSTILE = {
  '@context': 'https://schema.org',
  '@type': 'SportsActivityLocation',
  name: 'Saha </script><script>alert(1)</script>',
  description: '<!-- yorum --> & </SCRIPT > \u2028satır\u2029paragraf',
};

/** The element's text content as the HTML parser sees it, or `null` when it is not one element. */
function scriptText(html: string): string | null {
  const open = html.indexOf('>') + 1;
  const close = html.indexOf('</script>');
  const startsRight = html.startsWith('<script type="application/ld+json"');
  const endsRight = close === html.length - '</script>'.length;
  return startsRight && endsRight ? html.slice(open, close) : null;
}

describe('serializeJsonLd', () => {
  it('escapes every character that could end the element or open a comment', () => {
    const text = serializeJsonLd(HOSTILE);
    expect(text).not.toMatch(/[<>&\u2028\u2029]/);
    expect(text.toLowerCase()).not.toContain('</script');
    expect(text).not.toContain('<!--');
    expect(text).toContain('\\u003c/script\\u003e');
    expect(text).toContain('\\u003c!--');
    expect(text).toContain('\\u2028');
    expect(text).toContain('\\u2029');
  });

  it('round-trips to the same data', () => {
    expect(JSON.parse(serializeJsonLd(HOSTILE))).toEqual(HOSTILE);
  });
});

describe('JsonLdScript', () => {
  it('renders one data block whose content parses back to the data', () => {
    const html = renderToStaticMarkup(
      createElement(JsonLdScript, { data: HOSTILE, nonce: 'n0nce' }),
    );
    expect(html.match(/<script\b/g)).toHaveLength(1);
    expect(html.match(/<\/script>/gi)).toHaveLength(1);
    expect(html).toContain('nonce="n0nce"');
    const text = scriptText(html);
    expect(text).not.toBeNull();
    expect(JSON.parse(text ?? '')).toEqual(HOSTILE);
  });

  it('omits the nonce attribute when there is none', () => {
    const html = renderToStaticMarkup(createElement(JsonLdScript, { data: { a: 1 } }));
    expect(html).toBe('<script type="application/ld+json">{"a":1}</script>');
  });
});

describe('JsonLd', () => {
  beforeEach(() => {
    requestHeaders.delete(NONCE_HEADER);
  });

  it('takes the nonce the proxy forwarded for this request', async () => {
    requestHeaders.set(NONCE_HEADER, 'cHJveHktbm9uY2UtMTIzNA==');
    const html = renderToStaticMarkup(await JsonLd({ data: { a: '<' } }));
    expect(html).toBe(
      '<script type="application/ld+json" nonce="cHJveHktbm9uY2UtMTIzNA==">{"a":"\\u003c"}</script>',
    );
  });

  it('renders without a nonce outside the proxy', async () => {
    const html = renderToStaticMarkup(await JsonLd({ data: { a: 1 } }));
    expect(html).toBe('<script type="application/ld+json">{"a":1}</script>');
  });
});
