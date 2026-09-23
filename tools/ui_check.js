/* global document, n64js */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright';

// Exercise the real page without a ROM or external network dependencies.
execFileSync('bun', ['run', 'build'], { stdio: 'inherit' });
const root = resolve(import.meta.dir, '..');
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!path.startsWith(root + sep)) return new Response(null, { status: 403 });
    const file = Bun.file(path);
    return await file.exists() ? new Response(file) : new Response(null, { status: 404 });
  },
});
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: 'light' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === server.url.origin
    ? route.continue() : route.abort());
  await page.goto(server.url.href);
  await page.waitForFunction(() => document.querySelector('#cpu-tab').hasAttribute('aria-selected'));

  const theme = () => page.locator('html').getAttribute('data-theme');
  const selectTheme = async value => {
    await page.locator('#bd-theme').click();
    await page.locator(`[data-theme-value="${value}"]`).click();
    assert.equal(await page.locator('#theme-menu').isVisible(), false);
    assert.equal(await page.locator('#bd-theme').evaluate(e => e === document.activeElement), true);
  };
  assert.equal(await theme(), 'light');
  await selectTheme('dark');
  assert.equal(await theme(), 'dark');
  await page.reload();
  assert.equal(await theme(), 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  assert.equal(await theme(), 'dark');
  await selectTheme('auto');
  assert.equal(await theme(), 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.locator('#bd-theme').press('ArrowDown');
  assert.equal(await page.locator('[data-theme-value="light"]').evaluate(e => e === document.activeElement), true);
  await page.keyboard.press('End');
  assert.equal(await page.locator('[data-theme-value="auto"]').evaluate(e => e === document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#theme-menu').isVisible(), false);
  await page.locator('#bd-theme').click();
  await page.locator('h1').click();
  assert.equal(await page.locator('#theme-menu').isVisible(), false);

  await page.locator('[onclick="n64js.debugger().toggle()"]').click();
  await page.locator('#cpu-tab').click();
  assert.equal(await page.locator('#cpu-content').isVisible(), true);
  assert.equal(await page.locator('#output-content').isVisible(), false);
  await page.locator('#cpu1-tab').click();
  await page.locator('#rsp-tab').click();
  await page.locator('[data-tab-target="#rsp-vector-content"]').click();
  await page.locator('#cpu-tab').click();
  assert.equal(await page.locator('#cpu1-content').isVisible(), true);
  assert.equal(await page.locator('#cpu0-content').isVisible(), false);
  await page.locator('#cpu1-tab').press('ArrowRight');
  assert.equal(await page.locator('#cpu0-content').isVisible(), true);
  await page.locator('#cpu-tab').press('ArrowRight');
  assert.equal(await page.locator('#rsp-vector-content').isVisible(), true);
  assert.equal(await page.locator('#rsp-tab').getAttribute('aria-selected'), 'true');
  await page.evaluate(() => n64js.ui().showTab('memory-tab'));
  assert.equal(await page.locator('#memory-content').isVisible(), true);
  assert.equal(await page.locator('#rsp-content').isVisible(), false);
  await page.locator('#memory-tab').press('Home');
  assert.equal(await page.locator('#output-tab').getAttribute('aria-selected'), 'true');
  await page.locator('#output-tab').press('End');
  assert.equal(await page.locator('#timeline-content').isVisible(), true);
  // Switching with the keyboard must refresh a newly selected debugger panel.
  await page.evaluate(() => { document.querySelector('#cpu0-status-pc').textContent = ''; });
  await page.locator('#timeline-tab').press('Home');
  await page.locator('#output-tab').press('ArrowRight');
  assert.notEqual(await page.locator('#cpu0-status-pc').textContent(), '');

  const controller = page.locator('[onclick="n64js.ui().toggleControllerConfig()"]');
  const dialog = page.locator('#controller');
  const waitForClose = () => page.waitForFunction(() => !document.querySelector('#controller').open
    && !document.body.classList.contains('modal-open'));
  await controller.click();
  assert.equal(await dialog.isVisible(), true);
  assert.equal(await page.evaluate(() => document.querySelector('#controller').contains(document.activeElement)), true);
  await dialog.locator('.modal-footer button').last().focus();
  await page.keyboard.press('Tab');
  assert.equal(await dialog.locator('.btn-close').evaluate(e => e === document.activeElement), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await dialog.locator('.modal-footer button').last().evaluate(e => e === document.activeElement), true);
  await page.keyboard.press('Escape');
  await waitForClose();
  assert.equal(await controller.evaluate(e => e === document.activeElement), true);
  await controller.click();
  await dialog.locator('.btn-close').click();
  await waitForClose();
  await controller.click();
  await dialog.click({ position: { x: 5, y: 5 } });
  await waitForClose();
  await controller.click();
  await dialog.locator('.modal-footer [data-dialog-close]').click();
  await waitForClose();

  await page.evaluate(() => n64js.ui().displayWarning('UI check'));
  assert.match(await page.locator('#alerts').textContent(), /UI check/);
  await page.locator('[data-alert-close]').click();
  assert.equal(await page.locator('#alerts .alert').count(), 0);

  await page.setViewportSize({ width: 390, height: 844 });
  await controller.click();
  const panel = await dialog.locator('.modal-dialog').boundingBox();
  assert.ok(panel.x >= 0 && panel.x + panel.width <= 390);
  await page.keyboard.press('Escape');
  await waitForClose();
  await page.evaluate(() => localStorage.setItem('theme', 'invalid'));
  await page.reload();
  assert.equal(await theme(), 'dark');
  assert.deepEqual(errors, []);
  console.log('UI checks passed: themes, nested tabs, keyboard navigation, dialog focus/dismissal, alerts, narrow viewport.');
} finally {
  await browser?.close();
  server.stop(true);
}
