// Self-contained ESLint config (eslint 8 + eslintrc). `root: true` stops the walk
// to the repo-root config (which ignores apps/**). Without a local eslint the
// `eslint .` script fell through to a global eslint 9 (flat-config only) and failed.
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  env: { node: true, es2022: true },
  extends: ['eslint:recommended'],
  rules: {
    // TypeScript's compiler checks these more accurately; the base ESLint rules
    // false-positive on type-only identifiers.
    'no-undef': 'off',
    'no-unused-vars': 'off',
    // Allow intentional infinite loops (`while (true) { ... break }`) used for
    // retry/reconnect backoff; still flags constant conditions in if/ternary.
    'no-constant-condition': ['error', { checkLoops: false }],
  },
  ignorePatterns: ['build/', 'dist/', 'node_modules/'],
};
