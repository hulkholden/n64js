/* global window, document */ // Callbacks evaluated inside Playwright's page.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const visualBundle = 'build/texture_sampler_visual.js';
const imageFields = ['actual', 'golden', 'difference'];

async function main() {
  const options = readOptions();
  buildBundles();
  await mkdir(options.output, { recursive: true });

  const { server, url } = await startServer();
  const launchOptions = browserOptions(options.hardware);
  let browser;

  try {
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage({
      viewport: { width: 1100, height: 850 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    const pixelChecks = await runPixelChecks(page, url);
    const { cases, environment } = await loadVisualTests(page, url, options.hardware);
    const manifest = await createManifest(browser, launchOptions.args, environment, pixelChecks);
    manifest.cases = await runVisualTests(page, cases, options);

    if (errors.length) {
      throw new Error(errors.join('\n'));
    }

    const reportName = options.capture ? 'manifest.json' : 'results.json';
    await saveJSON(resolve(options.output, reportName), manifest);
    const failed = reportResults(manifest.cases, options);

    if (options.selfTest && !failed) {
      await runRegressionSelfTest(page, options.output);
      if (errors.length) {
        throw new Error(errors.join('\n'));
      }
    }
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }
}

function readOptions() {
  const { values } = parseArgs({
    options: {
      capture: { type: 'boolean', default: false },
      'self-test': { type: 'boolean', default: false },
      hardware: { type: 'boolean', default: false },
      output: { type: 'string', default: 'build/texture-sampler-results' },
    },
  });

  if (values.capture && values['self-test']) {
    throw new Error('Capture and self-test are separate operations.');
  }

  const output = resolve(root, values.output, values.capture ? 'candidate' : '.');
  const goldens = resolve(root, 'tools/texture_sampler/goldens');
  if (output === goldens || output.startsWith(goldens + sep)) {
    throw new Error('Capture to a separate directory, review the images, then copy approved files into goldens.');
  }

  return {
    capture: values.capture,
    selfTest: values['self-test'],
    hardware: values.hardware,
    output,
  };
}

function buildBundles() {
  const bundles = [
    ['tools/texture_sampler/visual.js', visualBundle],
    ['tools/texture_sampler_webgl.js', 'build/texture_sampler_webgl.js'],
  ];

  for (const [entry, bundle] of bundles) {
    execFileSync('bun', ['build', entry, `--outfile=${bundle}`], { cwd: root, stdio: 'inherit' });
  }
}

async function startServer() {
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
  };

  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const path = resolve(root, `.${pathname}`);
      if (relative(root, path).startsWith('..')) {
        throw new Error('Outside repository');
      }

      const body = await readFile(path);
      response.writeHead(200, {
        'Content-Type': mimeTypes[extname(path)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
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
  return { server, url };
}

function browserOptions(hardware) {
  // Chromium's full build exposes the normal GPU backend on macOS; the
  // headless shell is sufficient for the pinned SwiftShader comparisons.
  if (hardware) {
    return { headless: true, args: [], channel: 'chromium' };
  }

  return {
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  };
}

async function runPixelChecks(page, url) {
  await page.goto(`${url}/tools/texture_sampler_webgl.html`);
  await page.waitForFunction(() => /passed|FAIL/.test(document.title));

  const results = await page.locator('#results').innerText();
  if (!/^\d+ passed/.test(results)) {
    throw new Error(results);
  }

  const summary = results.split('\n')[0];
  console.log(`${summary} GPU pixel checks`);
  return summary;
}

async function loadVisualTests(page, url, hardware) {
  await page.goto(`${url}/tools/texture_sampler_visual.html?headless`);
  await page.waitForFunction(() => window.samplerVisualTests || document.title.startsWith('FAIL'));

  const ready = await page.evaluate(() => Boolean(window.samplerVisualTests));
  if (!ready) {
    throw new Error(await page.locator('#status').innerText());
  }

  const suite = await page.evaluate(() => {
    const { cases, environment } = window.samplerVisualTests;
    return { cases, environment };
  });
  if (!hardware && !suite.environment.gpu.includes('SwiftShader')) {
    throw new Error(`Expected SwiftShader, got ${suite.environment.gpu}`);
  }

  return suite;
}

async function createManifest(browser, launchArgs, environment, pixelChecks) {
  const gitOptions = { cwd: root, encoding: 'utf8' };
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], gitOptions).trim();
  const workingTreeStatus = execFileSync('git', ['status', '--porcelain'], gitOptions).trim();
  const playwrightPackage = await readFile(resolve(root, 'node_modules/playwright/package.json'), 'utf8');

  return {
    capturedAt: new Date().toISOString(),
    sourceRevision,
    workingTreeDirty: Boolean(workingTreeStatus),
    // Includes the GLSL sources and uncommitted scene/renderer changes.
    bundleSHA256: await hashFile(visualBundle),
    playwright: JSON.parse(playwrightPackage).version,
    browserVersion: browser.version(),
    platform: process.platform,
    architecture: process.arch,
    launchArgs,
    ...environment,
    presentation: {
      deviceScaleFactor: 1,
      comparison: 'raw framebuffer readback, independent of CSS scaling',
    },
    pixelChecks,
    cases: [],
  };
}

async function runVisualTests(page, cases, { capture, output }) {
  const results = [];
  for (const test of cases) {
    const renderOptions = { ...test, capture };
    const result = await page.evaluate(options => window.samplerVisualTests.render(options), renderOptions);
    results.push(withoutImages(result));

    if (capture) {
      await savePNG(resolve(output, `${result.key}.png`), result.actual);
    } else if (!result.passed) {
      await saveFailure(result, output);
      const reason = result.error || `${result.changedPixels} changed pixels (max ${result.maxDifference})`;
      console.error(`FAIL ${result.key}: ${reason}`);
    }
  }
  return results;
}

function reportResults(results, { capture, output }) {
  const directory = relative(root, output);
  if (capture) {
    console.log(`Captured ${results.length} candidates in ${directory}. Review before copying into tools/texture_sampler/goldens/.`);
    return 0;
  }

  const failed = results.filter(result => !result.passed).length;
  const passed = results.length - failed;
  console.log(`${passed}/${results.length} visual comparisons passed. Results: ${directory}`);
  if (failed) process.exitCode = 1;
  return failed;
}

async function runRegressionSelfTest(page, output) {
  // Deliberately remove native-pixel quantization, recreating the upscaled
  // menu-strip seam. Only the served test bundle changes; never source files.
  const source = 'floor(gl_FragCoord.xy * uTextureRectScreen.xy + uTextureRectScreen.zw)';
  const replacement = '(gl_FragCoord.xy * uTextureRectScreen.xy + uTextureRectScreen.zw)';
  const bundle = await readFile(resolve(root, visualBundle), 'utf8');
  if (!bundle.includes(source)) {
    throw new Error('Self-test mutation no longer matches the shader.');
  }

  const modifiedBundle = bundle.replace(source, replacement);
  await page.route('**/build/texture_sampler_visual.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: modifiedBundle,
  }));
  await page.reload();
  await page.waitForFunction(() => window.samplerVisualTests);

  const result = await page.evaluate(() => window.samplerVisualTests.render({
    id: 'adjacent-strips',
    scale: 2,
    frame: 0,
  }));
  if (result.passed || result.error || !result.changedPixels) {
    throw new Error('Self-test did not detect the injected sampling regression.');
  }

  const directory = resolve(output, 'self-test');
  await saveFailure(result, directory);
  await saveJSON(resolve(directory, 'results.json'), {
    mutation: 'Remove native rectangle pixel quantization',
    ...withoutImages(result),
  });
  console.log(`Self-test detected the menu-strip regression: ${result.changedPixels} changed pixels. Images: ${relative(root, directory)}`);
}

function withoutImages(result) {
  // Keep images on disk, not embedded in the machine-readable report.
  const summary = { ...result };
  for (const field of imageFields) delete summary[field];
  return summary;
}

async function hashFile(path) {
  const contents = await readFile(resolve(root, path));
  return createHash('sha256').update(contents).digest('hex');
}

async function saveJSON(path, value) {
  const json = JSON.stringify(value, null, 2) + '\n';
  await writeFile(path, json);
}

async function savePNG(path, dataURL) {
  if (!dataURL) return;
  const png = Buffer.from(dataURL.split(',')[1], 'base64');
  await writeFile(path, png);
}

async function saveFailure(result, directory) {
  await mkdir(directory, { recursive: true });
  for (const field of imageFields) {
    const path = resolve(directory, `${result.key}-${field}.png`);
    await savePNG(path, result[field]);
  }
}

await main();
