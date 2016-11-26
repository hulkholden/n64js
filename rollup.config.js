export default {
  entry: 'src/n64.js',
  indent: '\t',
  plugins: [],
  targets: [
    {
      format: 'umd',
      moduleName: 'N64JS',
      dest: 'build/n64.js'
    },
    {
      format: 'es',
      dest: 'build/n64.modules.js'
    }
  ]
};
