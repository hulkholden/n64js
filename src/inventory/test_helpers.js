import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CycleType, ImageFormat, ImageSize } from '../hle/graphics/gbi.js';

export const ci4 = { format: ImageFormat.G_IM_FMT_CI, size: ImageSize.G_IM_SIZ_4b, name: 'CI4' };
export const rgba16 = { format: ImageFormat.G_IM_FMT_RGBA, size: ImageSize.G_IM_SIZ_16b, name: 'RGBA16' };

export async function withDirectory(prefix, fn) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  try {
    await fn(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function invokeCLI(command, args, { cwd } = {}) {
  const child = Bun.spawn([process.execPath, command, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

export function swapRomBytes16(rom) {
  const swapped = rom.slice();
  for (let offset = 0; offset < swapped.length; offset += 2) {
    [swapped[offset], swapped[offset + 1]] = [swapped[offset + 1], swapped[offset]];
  }
  return swapped;
}

export function swapRomBytes32(rom) {
  const swapped = rom.slice();
  for (let offset = 0; offset < swapped.length; offset += 4) {
    [swapped[offset], swapped[offset + 1], swapped[offset + 2], swapped[offset + 3]] =
      [swapped[offset + 3], swapped[offset + 2], swapped[offset + 1], swapped[offset]];
  }
  return swapped;
}

// A synthetic bootstrap starts real RSP tasks, then spins with optional VI
// interrupts. No copyrighted ROM or emulator mocks are needed by the CLI tests.
export function makeROM({ vi = false, graphics = 'end', audio = false, rewriteCount = false, waitForInput = false } = {}) {
  const bytes = new Uint8Array(0x1000);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x80371240);
  bytes.set(new TextEncoder().encode('INVENTORY TEST'), 32);
  bytes[62] = 0x45;
  const code = [0x40806000]; // mtc0 zero, Status: disable guest interrupts.
  const store = (offset, value) => {
    code.push(0x3c090000 | (value >>> 16), 0x35290000 | (value & 0xffff), 0xad090000 | offset);
  };
  code.push(0x3c08a000); // t0 = uncached RDRAM base.
  const writeVersion = (address, text) => {
    const version = new TextEncoder().encode(text + '\0');
    const padded = new Uint8Array((version.length + 3) & ~3);
    padded.set(version);
    const words = new DataView(padded.buffer);
    for (let offset = 0; offset < padded.length; offset += 4) {
      store(address + offset, words.getUint32(offset));
    }
    return version.length;
  };
  const versionSize = writeVersion(0x2000, 'RSP Gfx ucode F3DEX fifo 2.0');
  let commands = [[0xdf000000, 0]];
  if (graphics === 'loop') {
    // A multi-command cycle exercises the synchronous HLE command guard.
    commands = [[0xde010000, 0x3008], [0xde010000, 0x3000]];
  }
  if (graphics === 'wait') {
    commands = [[0xde010000, 0x3000]];
  }
  if (graphics === 'switch') {
    const gbi1Size = writeVersion(0x5000, 'RSP Gfx ucode F3DEX 1.23');
    commands = [
      [0xe1000000, 0x80005000],
      [0xdd000000 | (gbi1Size - 1), 0x80004000], // GBI2 -> GBI1.
      [0xb4000000, 0x80002000],
      [0xaf000000 | (versionSize - 1), 0x80001000], // GBI1 -> GBI2.
      [0xdf000000, 0],
    ];
  }
  if (graphics === 'textures') {
    const tile = (index, format, size, line = 1) => [0xf5000000 | (format << 21) | (size << 19) | (line << 9), index << 24];
    commands = [
      tile(0, ImageFormat.G_IM_FMT_CI, ImageSize.G_IM_SIZ_8b), // Replaced before drawing.
      tile(0, ImageFormat.G_IM_FMT_CI, ImageSize.G_IM_SIZ_4b),
      tile(1, ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b),
      tile(2, ImageFormat.G_IM_FMT_I, ImageSize.G_IM_SIZ_8b), // Never selected.
      tile(3, ImageFormat.G_IM_FMT_IA, ImageSize.G_IM_SIZ_8b, 0), // Valid zero-stride tile.
      [0xef000000 | CycleType.G_CYC_2CYCLE, 0],
      [0xe4020020, 0], [0xe1000000, 0], [0xf1000000, 0x04000400],
      [0xe5020020, 0], [0xe1000000, 0], [0xf1000000, 0x04000400],
      [0xef000000 | CycleType.G_CYC_1CYCLE, 0],
      [0xe4020020, 3 << 24], [0xe1000000, 0], [0xf1000000, 0x04000400],
      [0xdf000000, 0],
    ];
  }
  commands.forEach(([cmd0, cmd1], index) => {
    store(0x3000 + index * 8, cmd0);
    store(0x3004 + index * 8, cmd1);
  });

  // This task header is copied into RSP DMEM along with the bootstrap code.
  for (const [offset, value] of [
    [0x00, 1], [0x10, 0x80001000], [0x14, 4],
    [0x18, 0x80002000], [0x1c, versionSize],
    [0x30, graphics === 'invalid' ? 0x1000000 : 0x3000],
  ]) {
    view.setUint32(0xfc0 + offset, value);
  }
  if (audio) {
    view.setUint32(0xfc0, 2);
    view.setUint32(0xfc8, 0x80004000);
    view.setUint32(0xfcc, 0x1000);
    view.setUint32(0xfd0, 0x80004000);
    view.setUint32(0xfd4, 0x1000);
    view.setUint32(0xfdc, 0x40);
    code.push(0x3c08a400); // SP memory: a minimal direct-loaded audio program.
    store(0x1000, 0x0000000d); // BREAK ends the task when the RSP executes it.
  }
  if (vi) {
    code.push(0x3c08a440); // t0 = VI registers.
    store(0x0c, 0); // Select an interrupt line independently of boot defaults.
    store(0x18, 525); // Start VI interrupts.
  }
  if (waitForInput) {
    code.push(0x3c08a000); // Set up a controller-1 read with an aligned response.
    store(0x6000, 0xff010401);
    store(0x6008, 0xfe000000);
    store(0x603c, 1);
    code.push(0x3c08a480); // SI registers: configure Joybus using a DMA write.
    store(0x00, 0x6000);
    store(0x10, 0x1fc007c0);
    code.push(0x3c10a430, 0x3c11a440, 0x3c12a480, 0x3c13a000); // MI, VI, SI, RAM bases.
    code.push(0x3c141000, 0x369450d0); // s4 = START, stick X=80, Y=-48.
    const poll = code.length;
    code.push(0x8e0a0008, 0x314a0008, 0x1140fffd, 0); // Wait for the next VI interrupt.
    code.push(0xae200010, 0xae400004, 0x8e6a6004); // Acknowledge VI; DMA/read controller response.
    code.push(0x15540000 | ((poll - code.length - 1) & 0xffff), 0); // Repeat until input matches.
  }
  if (graphics !== 'none') {
    code.push(0x3c08a404); // t0 = SP registers.
    store(0x10, 1); // Clear HALT to dispatch the task.
    // Both HLE graphics and LLE audio complete asynchronously. Do not submit
    // another task until the first one halts.
    code.push(0x8d0a0010, 0x314a0001, 0x1140fffd, 0);
    if (audio) {
      // Rewind the RSP PC for the next direct-loaded audio task.
      code.push(0x3c08a408);
      store(0, 0);
      code.push(0x3c08a404);
    }
    store(0x10, 1); // Start the same task again to exercise aggregation.
  }
  if (rewriteCount) {
    code.push(0x40804800, 0x1000fffe, 0); // Repeatedly write CP0 COUNT=0.
  } else {
    code.push(0x1000ffff, 0); // Infinite CPU loop, with an ordinary NOP delay slot.
  }
  code.forEach((instruction, index) => view.setUint32(0x40 + index * 4, instruction));
  return bytes;
}

export function makeReport(id, { family = 'GBI2', loaded = [family], formats = [], seed = 1 } = {}) {
  return {
    schemaVersion: 1,
    rom: { sha256: String(id).repeat(64), name: `ROM ${id}` },
    emulator: { revision: 'a'.repeat(40), dirty: false, runtime: 'bun', runtimeVersion: 'old-runtime' },
    settings: { seed, frames: 600, maxCycles: 10000000, timeoutMs: 30000, inputPolicy: { name: 'random-controller', version: 1 } },
    result: { status: 'completed', frames: 600, cycles: 123456, checkpointOnly: false, message: null },
    collectors: {
      'graphics.taskMicrocodes': { version: 1, scope: 'task-start', tasks: 1, microcodes: [{ family, detection: 'string', tasks: 1 }] },
      'graphics.microcodeLoads': { version: 1, scope: 'hle-load', loads: loaded.length, microcodes: loaded.map(item => ({ family: item, detection: 'string', loads: 1 })) },
      'graphics.textureFormats': { version: 1, scope: 'hle-draw', formats },
    },
  };
}

export async function writeScan(root, id, reports) {
  const directory = join(root, 'runs', id);
  const manifest = {
    schemaVersion: 1, id, createdAt: '2026-09-13T00:00:00.000Z', status: 'completed', sourceSha256: 'f'.repeat(64),
    emulator: reports[0].emulator, settings: reports[0].settings,
    entries: reports.map(report => ({
      path: `/roms/${report.rom.name}.z64`, sha256: report.rom.sha256, report: `${report.rom.sha256}.json`, status: report.result.status,
    })),
  };
  for (const report of reports) {
    await Bun.write(join(directory, `${report.rom.sha256}.json`), JSON.stringify(report));
  }
  await Bun.write(join(directory, 'manifest.json'), JSON.stringify(manifest));
  return { directory, manifest };
}
