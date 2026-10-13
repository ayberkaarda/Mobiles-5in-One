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
// The admin area (src/app/admin/**) is reachable only through the browser entry (ADR-0041).
const noAdminReach = [
  {
    // esquery regexes cannot contain a slash; `[^\w-]` stands for the path separator.
    selector: 'ImportExpression[source.value=/(^|[^\\w-])admin([^\\w-]|$)/]',
    message: 'Public code must not load the admin area; only src/main.ts provides its loader.',
  },
];
// The deletion panel (src/app/deletion/**) is reachable only through the browser entry too
// (ADR-0057); public code knows only the slot and the loader token in deletion-entry.ts.
const noDeletionReach = [
  {
    selector: 'ImportExpression[source.value=/(^|[^\\w-])deletion([^\\w-]|$)/]',
    message: 'Public code must not load the deletion panel; only src/main.ts provides its loader.',
  },
];
const deletionImportBan = {
  regex: '(^|/)deletion(/|$)',
  message: 'Public code must not import the deletion panel (ADR-0057).',
};
const sessionStoreBan = {
  group: ['@inecekvar/data-access', '@inecekvar/data-access/*', '**/libs/data-access/**'],
  message: 'Public SSR code must not load the browser session store.',
};
const adminImportBan = {
  regex: '(^|/)admin(/|$)',
  message: 'Public code must not import the admin area (ADR-0041).',
};
const storageBans = {
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
};
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

const selectors = {
  '@angular-eslint/directive-selector': [
    'error',
    { type: 'attribute', prefix: 'iv', style: 'camelCase' },
  ],
  '@angular-eslint/component-selector': [
    'error',
    { type: 'element', prefix: 'iv', style: 'kebab-case' },
  ],
};

export default [
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...noHtmlSinksTs,
        ...jsonLdOnly,
        ...noAdminReach,
        ...noDeletionReach,
      ],
      'no-restricted-imports': [
        'error',
        { patterns: [sessionStoreBan, adminImportBan, deletionImportBan] },
      ],
      ...storageBans,
      ...selectors,
    },
  },
  {
    files: ['src/app/seo/json-ld.service.ts', '**/src/app/seo/json-ld.service.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...noHtmlSinksTs, ...noAdminReach, ...noDeletionReach],
    },
  },
  // The browser entry is the one place that names the admin and deletion chunks (dynamic imports).
  {
    files: ['src/main.ts', '**/apps/web/src/main.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...noHtmlSinksTs, ...jsonLdOnly],
    },
  },
  // The client-only admin area may use the session store (cookie strategy, CSRF); HTML sinks,
  // sanitizer bypasses and browser storage stay banned there too.
  {
    files: ['src/app/admin/**/*.ts', '**/apps/web/src/app/admin/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...noHtmlSinksTs, ...jsonLdOnly],
      'no-restricted-imports': 'off',
      ...storageBans,
    },
  },
  // The client-only deletion panel uses the session store like the admin area, never the admin
  // code; HTML sinks, sanitizer bypasses and browser storage stay banned.
  {
    files: ['src/app/deletion/**/*.ts', '**/apps/web/src/app/deletion/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...noHtmlSinksTs, ...jsonLdOnly, ...noAdminReach],
      'no-restricted-imports': ['error', { patterns: [adminImportBan] }],
      ...storageBans,
    },
  },
  {
    files: ['**/*.html'],
    rules: {
      'no-restricted-syntax': ['error', ...noHtmlSinksTemplate],
    },
  },
];
