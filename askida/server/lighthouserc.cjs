/**
 * Lighthouse CI configuration of the Askida public web (spec section 8, Phase 5 gate). The pages
 * come from LHCI_URLS (comma separated absolute URLs) because the shop and district slugs depend
 * on the seeded data of the target environment. Each page is audited three times and the median
 * run is asserted; every category (performance, accessibility, best practices, SEO) must reach
 * 0.9. LCP over 2.5 s is a warning (simulated slow 4G is noisy), CLS over 0.1 an error.
 *
 * Local run against a seeded stack (see docs/seo/seo-geo-checklist.md):
 *   LHCI_URLS="http://localhost:58516/,http://localhost:58516/nasil-calisir,..." \
 *     npx @lhci/cli@0.15.1 autorun --config=askida/server/lighthouserc.cjs
 */

const urls = (process.env.LHCI_URLS ?? '')
  .split(',')
  .map((url) => url.trim())
  .filter((url) => url !== '');

if (urls.length === 0) {
  throw new Error('LHCI_URLS is empty: set it to the comma separated page URLs to audit');
}

module.exports = {
  ci: {
    collect: {
      url: urls,
      numberOfRuns: 3,
      settings: {
        // Default mobile emulation with simulated slow 4G; the sandbox flag is added on CI runners.
        chromeFlags: process.env.LHCI_CHROME_FLAGS ?? '--headless=new',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9, aggregationMethod: 'median-run' }],
        'categories:accessibility': ['error', { minScore: 0.9, aggregationMethod: 'median-run' }],
        'categories:best-practices': ['error', { minScore: 0.9, aggregationMethod: 'median-run' }],
        'categories:seo': ['error', { minScore: 0.9, aggregationMethod: 'median-run' }],
        'largest-contentful-paint': ['warn', { maxNumericValue: 2500, aggregationMethod: 'median' }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1, aggregationMethod: 'median' }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: process.env.LHCI_OUTPUT_DIR ?? '.lighthouseci',
    },
  },
};
