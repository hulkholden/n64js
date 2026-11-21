import { createHeadlessEmulator, loadROMFile } from '../headless/headless_env.js';
import { createInventoryCollectors } from './collectors.js';
import { createInputDriver, createRandom } from './input.js';
import { captureFailure } from './failure.js';
import { sendInventoryUpdate } from './ipc.js';
import { sha256Hex } from './schema.js';

// This process may block inside emulation. The CLI owns the wall-clock timeout
// and retains the last checkpoint received before terminating this process.
const CYCLE_LIMIT_EVENT = 'Inventory cycle limit';
const CYCLES_PER_BATCH = 10_000_000;

async function loadRomMetadata(romPath) {
  const loadedROM = await loadROMFile(romPath);
  const rom = {
    ...loadedROM.rominfo,
    // Hash the canonical big-endian ROM, before hardware pads its private copy.
    sha256: sha256Hex(new Uint8Array(loadedROM.romBuffer)),
    bytes: loadedROM.romBuffer.byteLength,
  };
  return { loadedROM, rom };
}

async function runWorker({ romPath, settings, expectedRomSha256 }) {
  const collectors = createInventoryCollectors();
  let rom = null;
  let emulator = null;
  let collecting = false;
  let cycleLimitReached = false;
  let status;
  let message = null;
  let failure = null;

  function cyclesExecuted() {
    if (!collecting) {
      return 0;
    }
    // Use event-queue time so guest COUNT writes and skipped idle loops cannot
    // evade the budget. At the deadline report the budget; an instruction batch
    // can finish a few cycles beyond it before the CPU yields.
    if (cycleLimitReached) {
      return settings.maxCycles;
    }
    return settings.maxCycles - emulator.cpu0.getCyclesUntilEvent(CYCLE_LIMIT_EVENT);
  }

  function snapshot() {
    return {
      rom,
      frames: emulator?.hardware.verticalBlankCount ?? 0,
      cycles: cyclesExecuted(),
      collectors: collecting ? collectors.snapshot() : {},
    };
  }

  function checkpoint() {
    return sendInventoryUpdate({ type: 'checkpoint', ...snapshot() });
  }

  try {
    const loaded = await loadRomMetadata(romPath);
    rom = loaded.rom;
    // Compare the same canonical bytes that will be used to create the emulator.
    if (expectedRomSha256 !== undefined && rom.sha256 !== expectedRomSha256) {
      throw new Error('ROM SHA-256 does not match the replay report');
    }
    await checkpoint();

    const updateInput = createInputDriver(settings.seed, settings.inputPolicy.script);
    emulator = await createHeadlessEmulator(loaded.loadedROM, {
      executeGraphics: true,
      onVerticalBlank: frame => updateInput(frame, emulator.inputs[0]),
      ...collectors.hooks,
      onHalt: (_message, details) => {
        failure = captureFailure(details ? 'exception' : 'halt', details?.error, emulator);
      },
      onWarning: warning => console.error(warning),
      onCheckFailure: checkMessage => console.error(checkMessage),
    });
    emulator.cpu0.setRandomSource(createRandom(settings.seed));
    emulator.cpu0.addEvent(CYCLE_LIMIT_EVENT, settings.maxCycles, () => {
      cycleLimitReached = true;
      emulator.cpu0.breakExecution();
    });
    collecting = true;
    await checkpoint();

    while (emulator.hardware.verticalBlankCount < settings.frames && !cycleLimitReached) {
      emulator.cpu0.run(CYCLES_PER_BATCH);
      const fatalError = emulator.fatalError();
      if (fatalError) {
        status = 'halted';
        message = fatalError;
        break;
      }
      await checkpoint();
    }
    status ??= emulator.hardware.verticalBlankCount >= settings.frames ? 'completed' : 'cycle-limit';
  } catch (error) {
    status = 'error';
    message = String(error?.message ?? error);
    failure = captureFailure('exception', error, emulator);
  }

  try {
    await sendInventoryUpdate({
      type: 'result',
      ...snapshot(),
      status,
      message,
      ...(failure ? { failure } : {}),
    });
  } catch (error) {
    // The parent still has the last delivered checkpoint. Keep transport failures
    // visible on stderr and distinguish them from a successful worker exit.
    console.error('Failed to deliver terminal inventory report:', error);
    process.exitCode = 1;
  } finally {
    if (process.connected) {
      process.disconnect();
    }
  }
}

if (import.meta.main) {
  await runWorker(JSON.parse(process.argv[2]));
}
