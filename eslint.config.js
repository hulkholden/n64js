import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    files: ['src/**/*.js', 'tools/**/*.js', 'eslint.config.js'],
    ...js.configs.recommended,
  },
  {
    files: ['src/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['src/**/*.test.js', 'src/**/*.bench.js', 'src/headless/**/*.js', 'src/systemtest/**/*.js', 'src/inventory/**/*.js'],
    languageOptions: { globals: { ...globals.nodeBuiltin, ...globals.bunBuiltin } },
  },
  {
    files: ['src/**/*.test.js', 'src/headless/headless_env.js'],
    languageOptions: { globals: { n64js: 'readonly' } },
  },
  {
    files: ['tools/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    files: ['tools/build.js', 'tools/systemtest/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.nodeBuiltin, ...globals.bunBuiltin },
    },
  },
];
