/**
 * eslint.config.mjs — AST-level lint for real bugs, complementing the custom
 * comment policy (lib/comment-lint.mjs). Deliberately narrow: it flags the
 * defects review misses (undefined refs, unused bindings, unreachable code,
 * duplicate keys) without imposing a style — formatting and comments are owned
 * elsewhere. Generated and vendored trees are ignored.
 */

import js from '@eslint/js';
import globals from 'globals';

// Bug-catching, not style. no-useless-escape / no-control-regex are disabled:
// they fire on intentional defensive escaping and NUL-byte binary detection,
// not defects. no-unused-vars is a warning so it surfaces dead code without
// gating CI on pre-existing cruft.

const SHARED_RULES = {
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-useless-escape': 'off',
  'no-control-regex': 'off',
};

export default [
  {
    ignores: [
      'node_modules/**',
      'lib/server/static/**',
      'apps/**',
      'packages/**/dist/**',
      'dist/**',
      'coverage/**',
      '.cx/**',
      'db/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: SHARED_RULES,
  },
  {
    // bin/construct is an ESM entrypoint with no .mjs extension.
    files: ['bin/construct'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
    rules: SHARED_RULES,
  },
];
