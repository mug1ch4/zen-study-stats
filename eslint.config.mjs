// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  // Global ignores (build outputs, vendored, assets, scripts, observer.js, vite config)
  { ignores: ['dist/**', 'docs/**', 'node_modules/**', '*.zip', 'store-assets/**', 'icons/**', 'scripts/**', 'eslint.config.mjs', 'observer.js', 'vite.config.ts'] },

  // Base recommended rules
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  // Project-specific overrides
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Catch-all error handling is intentional in this codebase (resilience-first).
      '@typescript-eslint/no-empty-function': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],

      // Allow explicit any in API boundary normalization (RawReportProgress etc.)
      '@typescript-eslint/no-explicit-any': 'warn',

      // Non-null assertions are used carefully after validation (idOk checks etc.)
      '@typescript-eslint/no-non-null-assertion': 'off',

      // Unused vars: allow _ prefix convention
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],

      // Floating promises are common in fire-and-forget content script code
      '@typescript-eslint/no-floating-promises': 'warn',

      // Allow require() in observer.js (MAIN world, ES5 compat)
      '@typescript-eslint/no-require-imports': 'off',

      // Type assertions are common in API boundary code
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',

      // Unsafe argument/assignment warnings for mock/dev code
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',

      // unbound-method: history.pushState patching is intentional
      '@typescript-eslint/unbound-method': 'warn',

      // Irregular whitespace: full-width spaces are intentional in Japanese UI text
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true }],

      // Misused promises: event handlers with async are common in UI code
      '@typescript-eslint/no-misused-promises': 'warn',

      // Unsafe return/member-access in data management code
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
    },
  },

  // Test and dev files can use non-null assertions and any freely
  {
    files: ['tests/**/*.ts', 'dev/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  // Prettier must be last to disable conflicting formatting rules
  eslintConfigPrettier,
);
