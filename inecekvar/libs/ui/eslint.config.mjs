import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';

// User-supplied text (line, stop and city names, notes) is rendered as text only: no HTML
// sinks and no sanitizer bypass anywhere in this project (spec section 6, ADR-0032).
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
      'no-restricted-syntax': ['error', ...noHtmlSinksTs],
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
    files: ['**/*.html'],
    rules: {
      'no-restricted-syntax': ['error', ...noHtmlSinksTemplate],
    },
  },
];
