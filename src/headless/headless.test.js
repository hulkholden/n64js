import { expect, test } from 'bun:test';
import { runHeadless } from './headless.js';

function fakeRuntime(run) {
  let cycles = 0;
  let interrupted = false;
  const cpu0 = {
    getOpsExecuted: () => cycles,
    breakExecution: () => { interrupted = true; },
    run: budget => {
      for (let i = 0; i < budget && !interrupted; i++) {
        cycles++;
        run();
      }
    },
  };
  return {
    loadROMFile: async () => ({}),
    createHeadlessEmulator: async () => ({ cpu0, fatalError: () => null }),
  };
}

test('output observer interrupts the current chunk and console capture is restored', async () => {
  const originalLog = console.log;
  const runtime = fakeRuntime(() => console.log('protocol finished'));
  const result = await runHeadless('unused', {
    runtime, maxCycles: 10, onOutput: line => line === 'protocol finished',
  });
  expect(result).toEqual({ stopped: true, cycles: 1, fatalError: null });
  expect(console.log).toBe(originalLog);
});

test('observer errors propagate and restore console capture', async () => {
  const originalLog = console.log;
  await expect(runHeadless('unused', {
    runtime: fakeRuntime(() => console.log('output')),
    maxCycles: 10,
    onOutput: () => { throw new Error('observer failed'); },
  })).rejects.toThrow('observer failed');
  expect(console.log).toBe(originalLog);
});
