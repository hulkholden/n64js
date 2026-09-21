/* global window, document */ // Callbacks evaluated inside Playwright's page.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { values } = parseArgs({ options: {
  capture: { type: 'boolean', default: false },
  'self-test': { type: 'boolean', default: false },
  hardware: { type: 'boolean', default: false },
  output: { type: 'string', default: 'build/texture-sampler-results' },
} });
if (values.capture && values['self-test']) throw new Error('Capture and self-test are separate operations.');
const output = resolve(root, values.output, values.capture ? 'candidate' : '.');
const goldens = resolve(root, 'tools/texture_sampler/goldens');
if (output === goldens || output.startsWith(goldens + sep)) {
  throw new Error('Capture to a separate directory, review the images, then copy approved files into goldens.');
}

for (const [entry, bundle] of [
  ['tools/texture_sampler/visual.js', 'build/texture_sampler_visual.js'],
  ['tools/texture_sampler_webgl.js', 'build/texture_sampler_webgl.js'],
]) {
  execFileSync('bun', ['build', entry, `--outfile=${bundle}`], { cwd: root, stdio: 'inherit' });
}
await mkdir(output, { recursive: true });

const mimeTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = resolve(root, `.${pathname}`);
    if (relative(root, path).startsWith('..')) throw new Error('Outside repository');
    const body = await readFile(path);
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const url = `http://127.0.0.1:${server.address().port}`;
const args = values.hardware ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
let browser;

async function savePNG(path, dataURL) {
  if (dataURL) await writeFile(path, Buffer.from(dataURL.split(',')[1], 'base64'));
}

async function saveFailure(result, directory) {
  await mkdir(directory, { recursive: true });
  for (const field of ['actual', 'golden', 'difference']) {
    await savePNG(resolve(directory, `${result.key}-${field}.png`), result[field]);
  }
}

function stats({ actual, golden, difference, ...result }) {
  // Keep images on disk, not embedded in the machine-readable report.
  void actual; void golden; void difference;
  return result;
}

try {
  // Chromium's full build exposes the normal GPU backend on macOS; the
  // headless shell is sufficient for the pinned SwiftShader comparisons.
  browser = await chromium.launch({ headless: true, args, ...(values.hardware ? { channel: 'chromium' } : {}) });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${url}/tools/texture_sampler_webgl.html`);
  await page.waitForFunction(() => /passed|FAIL/.test(document.title));
  const pixelChecks = await page.locator('#results').innerText();
  if (!/^\d+ passed/.test(pixelChecks)) throw new Error(pixelChecks);
  console.log(pixelChecks.split('\n')[0] + ' GPU pixel checks');

  await page.goto(`${url}/tools/texture_sampler_visual.html?headless`);
  await page.waitForFunction(() => window.samplerVisualTests || document.title.startsWith('FAIL'));
  if (!await page.evaluate(() => Boolean(window.samplerVisualTests))) throw new Error(await page.locator('#status').innerText());
  const { cases, environment } = await page.evaluate(() => ({ cases: window.samplerVisualTests.cases, environment: window.samplerVisualTests.environment }));
  if (!values.hardware && !environment.gpu.includes('SwiftShader')) throw new Error(`Expected SwiftShader, got ${environment.gpu}`);
  const manifest = {
    capturedAt: new Date().toISOString(),
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    workingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
    // These also identify uncommitted scene/renderer changes at capture time.
    bundleSHA256: createHash('sha256').update(await readFile(resolve(root, 'build/texture_sampler_visual.js'))).digest('hex'),
    shaderDocumentSHA256: createHash('sha256').update(await readFile(resolve(root, 'index.html'))).digest('hex'),
    playwright: JSON.parse(await readFile(resolve(root, 'node_modules/playwright/package.json'), 'utf8')).version,
    browserVersion: browser.version(), platform: process.platform, architecture: process.arch, launchArgs: args,
    ...environment,
    presentation: { deviceScaleFactor: 1, comparison: 'raw framebuffer readback, independent of CSS scaling' },
    pixelChecks: pixelChecks.split('\n')[0],
    cases: [],
  };
  for (const test of cases) {
    const result = await page.evaluate(options => window.samplerVisualTests.render(options), { ...test, capture: values.capture });
    manifest.cases.push(stats(result));
    if (values.capture) {
      await savePNG(resolve(output, `${result.key}.png`), result.actual);
    } else if (!result.passed) {
      await saveFailure(result, output);
      console.error(`FAIL ${result.key}: ${result.error || `${result.changedPixels} changed pixels (max ${result.maxDifference})`}`);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(resolve(output, values.capture ? 'manifest.json' : 'results.json'), JSON.stringify(manifest, null, 2) + '\n');

  const failed = manifest.cases.filter(result => !result.passed).length;
  if (values.capture) {
    console.log(`Captured ${cases.length} candidates in ${relative(root, output)}. Review before copying into tools/texture_sampler/goldens/.`);
  } else {
    console.log(`${cases.length - failed}/${cases.length} visual comparisons passed. Results: ${relative(root, output)}`);
    if (failed) process.exitCode = 1;
  }

  if (values['self-test'] && !failed) {
    // Deliberately remove native-pixel quantization, recreating the upscaled
    // menu-strip seam. Only the served test bundle changes; never source files.
    const source = 'floor(gl_FragCoord.xy * uTextureRectScreen.xy + uTextureRectScreen.zw)';
    const replacement = '(gl_FragCoord.xy * uTextureRectScreen.xy + uTextureRectScreen.zw)';
    const bundle = await readFile(resolve(root, 'build/texture_sampler_visual.js'), 'utf8');
    if (!bundle.includes(source)) throw new Error('Self-test mutation no longer matches the shader.');
    await page.route('**/build/texture_sampler_visual.js', route => route.fulfill({
      contentType: 'text/javascript', body: bundle.replace(source, replacement),
    }));
    await page.reload();
    await page.waitForFunction(() => window.samplerVisualTests);
    const result = await page.evaluate(() => window.samplerVisualTests.render({ id: 'adjacent-strips', scale: 2, frame: 0 }));
    if (result.passed || result.error || !result.changedPixels) throw new Error('Self-test did not detect the injected sampling regression.');
    const directory = resolve(output, 'self-test');
    await saveFailure(result, directory);
    await writeFile(resolve(directory, 'results.json'), JSON.stringify({ mutation: 'Remove native rectangle pixel quantization', ...stats(result) }, null, 2) + '\n');
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`Self-test detected the menu-strip regression: ${result.changedPixels} changed pixels. Images: ${relative(root, directory)}`);
  }
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
