import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Type-aware linting over `src/` only.
 *
 * The rule set is deliberately the recommended baseline plus the type-checked
 * rules — no house style layer. Formatting is not linted: there is no
 * formatter in this repo and a style ruleset nobody agreed to would produce
 * churn, not signal. What this catches is the class of thing typecheck does
 * not: floating promises, unsafe `any` flow, unused symbols.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'web/**', 'e2e/**', 'node_modules/**', 'eslint.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
);
