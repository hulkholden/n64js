export default {
  input: 'src/n64.js',
  plugins: [],
  output: [
    {
      format: 'umd',
      name: 'N64JS',
      file: 'build/n64.js'
    },
    {
      format: 'es',
      file: 'build/n64.modules.js'
    }
  ]
};
