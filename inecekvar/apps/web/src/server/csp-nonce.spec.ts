import { applyNonce, createNonce, NONCE_PLACEHOLDER } from './csp-nonce';
import { expectNonceAttributes, fakeHtml } from './test-helpers';

describe('response CSP nonces', () => {
  it('checks executable inline scripts without requiring nonces on data blocks', () => {
    const nonce = createNonce();
    const body = applyNonce(fakeHtml, nonce);
    expectNonceAttributes({
      status: 200,
      headers: { 'content-security-policy': `script-src 'self' 'nonce-${nonce}'` },
      body,
      bytes: Buffer.from(body),
    });
  });

  it('replaces nonce attributes and leaves transferred state unchanged on each response', () => {
    const html =
      `<iv-root ngcspnonce="${NONCE_PLACEHOLDER}"></iv-root>` +
      `<script nonce="${NONCE_PLACEHOLDER}">window.example = 1;</script>` +
      '<script id="ng-state" type="application/json">{"kept":true}</script>';
    const first = createNonce();
    const second = createNonce();
    const firstBody = applyNonce(html, first);
    const secondBody = applyNonce(html, second);
    expect(first).not.toBe(second);
    const responses = [
      [firstBody, first],
      [secondBody, second],
    ] as const;
    for (const [body, nonce] of responses) {
      expect(body).toContain(`ngcspnonce="${nonce}"`);
      expect([...body.matchAll(/\snonce="([^"]*)"/g)].map((match) => match[1])).toEqual([nonce]);
      expect(body).toContain(
        '<script id="ng-state" type="application/json">{"kept":true}</script>',
      );
      expect(body).not.toContain(NONCE_PLACEHOLDER);
    }
  });

  it('does not grant a nonce to unrelated scripts or overwrite an existing nonce', () => {
    const html =
      '<script>window.example = 1;</script>' +
      '<script id="ng-state" type="application/json" nonce="kept">{}</script>' +
      '<script id="other" type="application/json">{}</script>' +
      '<script id="ng-state" type="application/json" src="/data.js"></script>';
    expect(applyNonce(html, createNonce())).toBe(html);
  });

  it('never puts the live nonce into text nodes, whose quotes the server renderer leaves raw', () => {
    const hostile = `foo nonce="${NONCE_PLACEHOLDER}" bar`;
    const html =
      `<h1>${hostile}</h1>` +
      `<li>Durak ngcspnonce="${NONCE_PLACEHOLDER}"/></li>` +
      `<p>a</p> nonce="${NONCE_PLACEHOLDER}">` +
      `<td>&lt;b nonce="${NONCE_PLACEHOLDER}"&gt;</td>` +
      `<script type="module" data-x="1" nonce="${NONCE_PLACEHOLDER}"></script>`;
    const nonce = createNonce();
    const body = applyNonce(html, nonce);
    expect(body.split(nonce)).toHaveLength(2);
    expect(body).toContain(`<script type="module" data-x="1" nonce="${nonce}"></script>`);
    expect(body).toContain(`<h1>${hostile}</h1>`);
    expect(body).toContain(`<li>Durak ngcspnonce="${NONCE_PLACEHOLDER}"/></li>`);
    expect(body).toContain(`<p>a</p> nonce="${NONCE_PLACEHOLDER}">`);
    expect(body).toContain(`<td>&lt;b nonce="${NONCE_PLACEHOLDER}"&gt;</td>`);
  });

  it('rejects a nonce that is unsafe to place in an attribute', () => {
    expect(() => applyNonce('<iv-root></iv-root>', 'bad"nonce')).toThrow('Invalid CSP nonce');
  });
});
