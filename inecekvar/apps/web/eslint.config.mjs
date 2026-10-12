import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';

// Public text remains text throughout rendering and hydration.
const noHtmlSinksTs = [
  {
    selector: 'MemberExpression[property.name=/^bypassSecurityTrust/]',
    message: 'Do not bypass Angular sanitization; render user text as text.',
  },
  {
    selector: 'MemberExpression[property.name=/^(innerHTML|outerHTML)$/]',
    message: 'Do not write HTML strings into the DOM; render user text as text.',
  },
  {
    selector: 'CallExpression[callee.property.name=/^(insertAdjacentHTML|write|writeln)$/]',
    message: 'Do not write HTML strings into the DOM; render user text as text.',
  },
];
const jsonLdOnly = [
  {
    selector: "Literal[value='application/ld+json']",
    message: 'JSON-LD enters the document only through JsonLdService.',
  },
  {
    selector: "CallExpression[callee.property.name='createElement'][arguments.0.value=/^script$/i]",
    message: 'JSON-LD enters the document only through JsonLdService.',
  },
];
const noHtmlSinksTemplate = [
  {
    selector: 'BoundAttribute[name=/^(innerHTML|outerHTML|srcdoc)$/i]',
    message: 'Do not bind HTML into templates; render user text with interpolation.',
  },
  {
    selector: 'TextAttribute[name=/^(innerhtml|outerhtml|srcdoc)$/i]',
    message: 'Do not bind HTML into templates; render user text with interpolation.',
  },
];

export default [
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...noHtmlSinksTs, ...jsonLdOnly],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@inecekvar/data-access',
                '@inecekvar/data-access/*',
                '**/libs/data-access/**',
              ],
              message: 'Public SSR code must not load the browser session store.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'Public SSR pages keep no browser storage.' },
        { name: 'sessionStorage', message: 'Public SSR pages keep no browser storage.' },
        { name: 'indexedDB', message: 'Public SSR pages keep no browser storage.' },
      ],
      'no-restricted-properties': [
        'error',
        ...['globalThis', 'window'].flatMap((object) =>
          ['localStorage', 'sessionStorage'].map((property) => ({
            object,
            property,
            message: 'Public SSR pages keep no browser storage.',
          })),
        ),
      ],
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'iv',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'iv',
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    files: ['src/app/seo/json-ld.service.ts', '**/src/app/seo/json-ld.service.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...noHtmlSinksTs],
    },
  },
  {
    files: ['**/*.html'],
    rules: {
      'no-restricted-syntax': ['error', ...noHtmlSinksTemplate],
    },
  },
];
