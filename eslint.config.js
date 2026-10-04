import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'functions/lib', 'node_modules', 'functions/node_modules', 'playwright-report', 'test-results'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // The frontend must never talk to AI/SMS providers or import backend-only code.
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['**/functions/src/lib/*', '**/functions/src/services/*', 'firebase-admin', 'firebase-functions*'], message: 'Backend-only code cannot be imported by the frontend.' }] },
      ],
    },
  },
  {
    // Shared domain code must stay platform-neutral.
    files: ['functions/src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['node:*', 'firebase*', 'firebase-admin*', 'react*'], message: 'functions/src/shared must stay platform-neutral.' }] }],
    },
  },
);
