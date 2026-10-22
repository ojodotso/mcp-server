// Self-contained flat config (ESLint 9). Lints the TypeScript sources only, as `eslint . --ext
// .ts,.tsx` did under ESLint 8.
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';

export default [
  { ignores: ['build/', 'dist/', '**/.*', '**/*.{js,cjs,mjs}'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
    rules: {
      ...js.configs.recommended.rules,
      // TypeScript's compiler checks these more accurately; the base ESLint rules
      // false-positive on type-only identifiers.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      // Allow intentional infinite loops (`while (true) { ... break }`) used for
      // retry/reconnect backoff; still flags constant conditions in if/ternary.
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
];
