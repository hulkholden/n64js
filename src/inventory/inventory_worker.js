import { createHash } from 'node:crypto';
import { createHeadlessEmulator, loadROMFile } from '../headless_env.js';
import { createInputDriver, createRandom } from './inventory_input.js';
import { ImageFormat } from '../hle/gbi.js';

// This process may block inside emulation. The CLI owns the wall-clock timeout
// and retains the last checkpoint received before terminating this process.
const { romPath, settings, expectedRomSha256 } = JSON.parse(process.argv[2]);
let rom = null;
let emulator = null;
let collecting = false;
const cycleLimitEvent = 'Inventory cycle limit';
let cycleLimitReached = false;
let tasks = 0;
const taskMicrocodes = new Map();
let loads = 0;
const loadedMicrocodes = new Map();
const textureFormats = new Map();

function cyclesExecuted() {
  if (!collecting) return 0;
  // Use event-queue time so guest COUNT writes and skipped idle loops cannot
  // evade the budget. At the deadline report the budget; an instruction batch
  // can finish a few cycles beyond it before the CPU yields.
  if (cycleLimitReached) return settings.maxCycles;
  return settings.maxCycles - emulator.cpu0.getCyclesUntilEvent(cycleLimitEvent);
}

function snapshot() {
  return {
    rom,
    frames: emulator?.hardware.verticalBlankCount ?? 0,
    cycles: cyclesExecuted(),
    collectors: collecting ? {
      'graphics.taskMicrocodes': {
        version: 1,
        scope: 'task-start',
        tasks,
        microcodes: [...taskMicrocodes.values()],
      },
      'graphics.microcodeLoads': {
        version: 1,
        scope: 'hle-load',
        loads,
        microcodes: [...loadedMicrocodes.values()],
      },
      'graphics.textureFormats': {
        version: 1,
        scope: 'hle-draw',
        formats: [...textureFormats.values()],
      },
    } : {},
  };
}

function checkpoint() {
  process.send({ type: 'checkpoint', ...snapshot() });
}

let status;
let message = null;
try {
  const loadedROM = await loadROMFile(romPath);
  rom = {
    ...loadedROM.rominfo,
    // Hash the canonical big-endian ROM, before hardware pads its private copy.
    sha256: createHash('sha256').update(new Uint8Array(loadedROM.romBuffer)).digest('hex'),
    bytes: loadedROM.romBuffer.byteLength,
  };
  // Compare the same canonical bytes that will be used to create the emulator.
  if (expectedRomSha256 !== undefined && rom.sha256 !== expectedRomSha256) {
    throw new Error('ROM SHA-256 does not match the replay report');
  }
  checkpoint();
  const updateInput = createInputDriver(settings.seed, settings.inputPolicy.script);
  emulator = await createHeadlessEmulator(loadedROM, {
    executeGraphics: true,
    onVerticalBlank: frame => updateInput(frame, emulator.inputs[0]),
    onGraphicsTask: info => {
      tasks++;
      const key = JSON.stringify(info);
      const record = taskMicrocodes.get(key);
      if (record) {
        record.tasks++;
      } else {
        taskMicrocodes.set(key, { ...info, tasks: 1 });
      }
    },
    onMicrocodeLoad: info => {
      loads++;
      const key = JSON.stringify(info);
      const record = loadedMicrocodes.get(key);
      if (record) {
        record.loads++;
      } else {
        loadedMicrocodes.set(key, { ...info, loads: 1 });
      }
    },
    onTextureUse: info => {
      const key = `${info.format}:${info.size}`;
      if (!textureFormats.has(key)) {
        const format = ImageFormat.nameOf(info.format).replace('G_IM_FMT_', '');
        textureFormats.set(key, { ...info, name: `${format}${4 << info.size}` });
      }
    },
    onWarning: message => console.error(message),
    onCheckFailure: message => console.error(message),
  });
  emulator.cpu0.setRandomSource(createRandom(settings.seed));
  emulator.cpu0.addEvent(cycleLimitEvent, settings.maxCycles, () => {
    cycleLimitReached = true;
    emulator.cpu0.breakExecution();
  });
  collecting = true;
  checkpoint();
  // Flush the initial checkpoint before entering potentially blocking code.
  await Bun.sleep(0);

  while (emulator.hardware.verticalBlankCount < settings.frames && !cycleLimitReached) {
    emulator.cpu0.run(10_000_000);
    const fatalError = emulator.fatalError();
    if (fatalError) {
      status = 'halted';
      message = fatalError;
      break;
    }
    checkpoint();
    await Bun.sleep(0);
  }
  status ??= emulator.hardware.verticalBlankCount >= settings.frames ? 'completed' : 'cycle-limit';
} catch (error) {
  status = 'error';
  message = String(error?.message ?? error);
}

process.send({ type: 'result', ...snapshot(), status, message });
process.disconnect();
