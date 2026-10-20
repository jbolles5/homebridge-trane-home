import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['dist/**', 'artifacts/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['test/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' },
    },
  },
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
);
