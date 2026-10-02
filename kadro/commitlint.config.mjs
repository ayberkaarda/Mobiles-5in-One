/** Conventional Commits, enforced by the `commit-msg` hook defined in lefthook.yml. */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'repo',
        'mobile',
        'web',
        'api',
        'worker',
        'contracts',
        'config',
        'db',
        'auth',
        'emails',
        'adr',
        'api-docs',
        'brand',
        'seo',
        'security',
        'ci',
        'ops',
        'docs',
        'deps',
      ],
    ],
    'subject-case': [2, 'never', ['upper-case', 'pascal-case', 'start-case']],
    'header-max-length': [2, 'always', 100],
  },
};
