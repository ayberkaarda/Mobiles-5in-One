import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import prettierConfig from 'eslint-config-prettier';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import security from 'eslint-plugin-security';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Single flat config for the whole monorepo. Every workspace runs `eslint .`
 * from its own directory; ESLint resolves this file by walking up the tree,
 * so file globs below are relative to the repository root.
 */
export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.expo/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      '**/expo-env.d.ts',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  security.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Security checklist item 1: packages/config is the only reader of process.env.
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            'Read configuration through @kadro/config; it is the only module allowed to touch process.env.',
        },
      ],
      // Security checklist item 15: no raw SQL assembled from interpolated or concatenated strings.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='sql'][callee.property.name='raw'] > TemplateLiteral[expressions.length>0]",
          message:
            'sql.raw() with interpolation is forbidden; use the sql`` template with bound parameters.',
        },
        {
          selector:
            "CallExpression[callee.object.name='sql'][callee.property.name='raw'] > BinaryExpression[operator='+']",
          message:
            'sql.raw() with string concatenation is forbidden; use the sql`` template with bound parameters.',
        },
      ],
    },
  },
  {
    files: ['packages/config/src/**/*.ts'],
    rules: {
      'no-restricted-properties': 'off',
    },
  },
  {
    files: ['**/*.tsx'],
    ...react.configs.flat.recommended,
    ...react.configs.flat['jsx-runtime'],
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      globals: { ...globals.browser },
    },
    settings: { react: { version: '19.2' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      // Security checklist item 16: never inject raw HTML.
      'react/no-danger': 'error',
      'react/prop-types': 'off',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      // Tests deliberately feed environment-shaped objects and index into fixtures.
      'security/detect-object-injection': 'off',
    },
  },
  prettierConfig,
);
