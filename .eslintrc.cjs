module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  ignorePatterns: [
    'dist',
    'release',
    'node_modules',
    '*.config.js',
    '*.config.cjs',
    'vite.config.ts',
  ],
  overrides: [
    // ---- TypeScript / React renderer -----------------------------------
    {
      files: ['src/**/*.{ts,tsx}'],
      env: { browser: true, node: false, es2022: true },
      parser: '@typescript-eslint/parser',
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      plugins: ['@typescript-eslint', 'react', 'react-hooks'],
      extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:react/recommended',
        'plugin:react-hooks/recommended',
      ],
      settings: { react: { version: 'detect' } },
      rules: {
        'react/react-in-jsx-scope': 'off',
        'react/prop-types': 'off',
        'react/no-unescaped-entities': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': [
          'warn',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        'no-empty': ['warn', { allowEmptyCatch: true }],
      },
    },

    // ---- Electron main / preload (CommonJS Node) -----------------------
    {
      files: ['electron/**/*.js'],
      env: { node: true, browser: false, es2022: true },
      parserOptions: { ecmaVersion: 'latest', sourceType: 'script' },
      extends: ['eslint:recommended'],
      rules: {
        'no-empty': ['warn', { allowEmptyCatch: true }],
        'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      },
    },
  ],
};
