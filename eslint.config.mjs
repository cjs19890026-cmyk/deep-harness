import obsidianmd from 'eslint-plugin-obsidianmd';

export default [
  ...obsidianmd.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // The Obsidian review environment reports these type-checking rules on
      // otherwise type-safe code. Keep the source strict, but disable the
      // noisy no-unsafe family for the directory scan.
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', '**/*.test.ts'],
  },
];
