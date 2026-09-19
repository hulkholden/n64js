import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('./run.js', import.meta.url));

describe('system-test checkout runtime', () => {
  for (const runtimePath of ['src/headless/headless_env.js', 'src/headless_env.js']) {
    test(`runs a checkout with ${runtimePath}`, async () => {
      const checkout = await mkdtemp(join(tmpdir(), 'n64js-systemtest-runtime-'));
      try {
        await Bun.write(join(checkout, runtimePath), `
          export async function loadROMFile() { return {}; }
          export async function createHeadlessEmulator() {
            let cycles = 0;
            return {
              cpu0: {
                getOpsExecuted: () => cycles,
                run: count => {
                  cycles += count;
                  console.log('Done! Tests: 1. Failed: 0');
                },
                breakExecution() {},
              },
              fatalError: () => null,
            };
          }
        `);
        const output = join(checkout, 'result.json');
        const child = Bun.spawn([process.execPath, runner, checkout, 'fixture.z64', output, '1'], {
          stdout: 'pipe', stderr: 'pipe',
        });
        const [code, , stderr] = await Promise.all([
          child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
        ]);
        expect(stderr).toContain('complete: 1 completed test cases');
        expect(code).toBe(0);
        expect(await Bun.file(output).json()).toMatchObject({ status: 'complete', tests: 1, failed: 0 });
      } finally {
        await rm(checkout, { recursive: true, force: true });
      }
    });
  }
});
