const args = process.argv.slice(2);
const version = process.env.BUILD_VERSION || 'development';
const build = Bun.spawn([
  process.execPath, 'build', './src/n64.js', '--outfile=build/n64.min.js',
  '--define', `__BUILD_VERSION__=${JSON.stringify(version)}`,
  ...(args.includes('--debug') ? [] : ['--minify']),
  ...args.filter(arg => arg !== '--debug'),
], {
  stdout: 'inherit',
  stderr: 'inherit',
});

process.exit(await build.exited);
