import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ErrorPage from '../app/error';
import GlobalError from '../app/global-error';

const leaky = Object.assign(
  new Error('relation "users" does not exist at /srv/kadro/apps/web/app/page.tsx:3'),
  { digest: '2734198412' },
);

describe('error pages (security checklist item 13)', () => {
  for (const [name, Page] of [
    ['app/error.tsx', ErrorPage],
    ['app/global-error.tsx', GlobalError],
  ] as const) {
    it(`${name} shows a generic message and the digest only`, () => {
      const html = renderToStaticMarkup(<Page error={leaky} retry={() => undefined} />);
      expect(html).toContain('Bir şeyler ters gitti');
      expect(html).toContain('2734198412');
      for (const leak of ['relation', 'users', '/srv/', 'page.tsx', 'does not exist']) {
        expect(html).not.toContain(leak);
      }
    });

    it(`${name} renders without a digest`, () => {
      const html = renderToStaticMarkup(
        <Page error={new Error('stack detail')} retry={() => undefined} />,
      );
      expect(html).not.toContain('stack detail');
      expect(html).not.toContain('Referans');
    });
  }
});
