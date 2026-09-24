import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    files: ['src/**/*.js', 'js/**/*.js', 'tools/**/*.js', 'eslint.config.js'],
    ...js.configs.recommended,
  },
  {
    files: ['src/**/*.js', 'js/**/*.js'],
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
    files: ['tools/build.js', 'tools/systemtest/**/*.js', 'tools/texture_sampler/run.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.nodeBuiltin, ...globals.bunBuiltin },
    },
  },
  {
    files: ['tools/texture_sampler_webgl.js', 'tools/fog_webgl.js', 'tools/texture_sampler/scenes.js', 'tools/texture_sampler/visual.js'],
    languageOptions: { sourceType: 'module', globals: globals.browser },
  },
];
