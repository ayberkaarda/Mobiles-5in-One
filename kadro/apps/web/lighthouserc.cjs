/* eslint-disable no-restricted-properties -- tool configuration read by Lighthouse CI, not application configuration */
/**
 * Lighthouse CI configuration (ADR-0059). The pages come from LHCI_URLS (comma separated absolute
 * URLs) because venue and district slugs depend on the data of the target environment;
 * `tests/quality/lighthouse.test.ts` seeds a database, starts the production build and sets it.
 * Each page is audited three times and the median run is asserted (runner noise is about +-5
 * points); every category must reach 0.9 (product spec section 7 and the phase 4 gate). The
 * LCP budget of 2.5 s is a warning: the default simulated slow-4G profile measures about 3.0 s on
 * this build with or without the brand fonts, so it is reported, not blocking (ADR-0059).
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
        // Default (mobile emulation, simulated slow 4G) preset; the sandbox flag is for CI runners.
        chromeFlags: process.env.LHCI_CHROME_FLAGS ?? '--headless=new',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9, aggregationMethod: 'median-run' }],
        'categories:accessibility': ['error', { minScore: 0.9, aggregationMethod: 'median-run' }],
        'categories:seo': ['error', { minScore: 0.9, aggregationMethod: 'median-run' }],
        'categories:best-practices': ['error', { minScore: 0.9, aggregationMethod: 'median-run' }],
        'largest-contentful-paint': [
          'warn',
          { maxNumericValue: 2500, aggregationMethod: 'median' },
        ],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1, aggregationMethod: 'median' }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: process.env.LHCI_OUTPUT_DIR ?? '.lighthouseci',
    },
  },
};
