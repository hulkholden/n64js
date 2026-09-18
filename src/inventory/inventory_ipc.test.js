import { expect, test } from 'bun:test';
import { fork } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ipcModule = new URL('./inventory_ipc.js', import.meta.url).href;

async function withWorker(source, inspect) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'n64js-inventory-ipc-')));
  let child;
  let timer;
  try {
    const path = join(directory, 'worker.js');
    await writeFile(path, `import { sendInventoryUpdate } from ${JSON.stringify(ipcModule)};\n${source}`);
    child = fork(path, [], { execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    const messages = [];
    let stderr = '';
    child.stdout.resume();
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('message', update => messages.push(update));
    const result = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code, signal) => resolve({ code, signal }));
    });
    inspect({ ...result, messages, stderr });
  } finally {
    clearTimeout(timer);
    if (child && child.exitCode === null) child.kill('SIGKILL');
    await rm(directory, { recursive: true, force: true });
  }
}

test('flushes large checkpoints and terminal failure evidence before disconnecting', async () => {
  // Exceed the IPC socket buffer without a ROM or an emulator failure. Immediate
  // send/disconnect loses both later checkpoints and the terminal report on Bun.
  const records = Array.from({ length: 1000 }, (_, hash) => ({
    hash, family: 'GBI0', version: 'RSP SW Version: 2.0H, 02-12-97', tasks: 1,
  }));
  const failure = {
    version: 1, kind: 'exception',
    exception: { name: 'RangeError', message: 'test failure', stack: 'RangeError: test failure\n    at fixture (worker.js:1:1)' },
    context: { cpu: { pc: 0x80001000, nextPC: 0x80001004, delayPC: 0 }, rsp: { pc: 4, halted: true } },
  };
  await withWorker(`
    const collectors = { 'graphics.taskMicrocodes': { version: 1, tasks: 1000, microcodes: ${JSON.stringify(records)} } };
    for (let frames = 1; frames <= 256; frames++) {
      await sendInventoryUpdate({ type: 'checkpoint', frames, collectors });
    }
    await sendInventoryUpdate({ type: 'result', frames: 256, status: 'halted', collectors, failure: ${JSON.stringify(failure)} });
    process.disconnect();
  `, ({ code, signal, messages, stderr }) => {
    expect({ code, signal, stderr }).toEqual({ code: 0, signal: null, stderr: '' });
    expect(messages).toHaveLength(257);
    expect(messages.slice(0, 256).map(update => update.frames)).toEqual(Array.from({ length: 256 }, (_, i) => i + 1));
    expect(messages.every(update => update.collectors['graphics.taskMicrocodes'].microcodes.length === records.length)).toBe(true);
    expect(messages.at(-1)).toEqual({
      type: 'result', frames: 256, status: 'halted', failure,
      collectors: { 'graphics.taskMicrocodes': { version: 1, tasks: 1000, microcodes: records } },
    });
  });
});

test('rejects a send when the IPC channel is closed', async () => {
  await withWorker(`
    process.disconnect();
    try {
      await sendInventoryUpdate({ type: 'result' });
      process.exitCode = 2;
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  `, ({ code, signal, messages, stderr }) => {
    expect({ code, signal, messages }).toEqual({ code: 1, signal: null, messages: [] });
    expect(stderr).toContain('IPC');
  });
});
