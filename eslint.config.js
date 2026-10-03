import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';

export default [
  {
    files: ['src/**/*.js', 'js/**/*.js', 'tools/**/*.js', 'eslint.config.js'],
    ...js.configs.recommended,
    plugins: { '@stylistic': stylistic },
    rules: {
      ...js.configs.recommended.rules,
      curly: ['error', 'all'],
      '@stylistic/block-spacing': ['error', 'always'],
      '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
      '@stylistic/curly-newline': ['error', {
        consistent: true,
        IfStatementConsequent: 'always',
        IfStatementAlternative: 'always',
        ForStatement: 'always',
        ForInStatement: 'always',
        ForOfStatement: 'always',
        WhileStatement: 'always',
        DoWhileStatement: 'always',
      }],
      '@stylistic/indent': ['error', 2, { SwitchCase: 1 }],
      '@stylistic/no-trailing-spaces': ['error', { skipBlankLines: true, ignoreComments: true }],
    },
  },
  {
    // Keep register flag updates and conditional logging compact, but require braces.
    files: ['src/devices/**/*.js'],
    ignores: ['src/devices/**/*.test.js', 'src/devices/**/*.bench.js'],
    rules: {
      '@stylistic/brace-style': 'off',
      '@stylistic/curly-newline': 'off',
    },
  },
  {
    // Preserve these devices' existing four-space indentation.
    files: ['src/devices/ri.js', 'src/devices/rom.js'],
    rules: { '@stylistic/indent': ['error', 4, { SwitchCase: 1 }] },
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
    files: ['tools/texture_sampler_webgl.js', 'tools/fog_webgl.js', 'tools/light_color_webgl.js', 'tools/modify_vertex_webgl.js', 'tools/s2dex_bg_*.js', 'tools/texture_sampler/scenes.js', 'tools/texture_sampler/visual.js'],
    languageOptions: { sourceType: 'module', globals: globals.browser },
  },
];
