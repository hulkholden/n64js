// Core modules currently publish a small API through window.n64js. In a
// headless runtime globalThis provides the equivalent shared namespace.
globalThis.window = globalThis;
globalThis.n64js ??= {};

let modulesPromise;

function loadModules() {
  modulesPromise ??= Promise.all([
    import('../boot.js'),
    import('../controllers.js'),
    import('../endian.js'),
    import('../hardware.js'),
    import('../joybus.js'),
    import('../cpu/r4300.js'),
    import('../romdb.js'),
    import('../rsp/rsp.js'),
    import('../system_constants.js'),
    import('../hle/headless_graphics.js'),
  ]);
  return modulesPromise;
}

export async function loadROMFile(romPath) {
  const [,, { fixRomByteOrder },,,, { generateCICType, generateRomId, romdb, uint8ArrayReadString },, constants] = await loadModules();
  const romFile = Bun.file(romPath);
  if (!await romFile.exists()) {
    throw new Error(`ROM not found: ${romPath}`);
  }

  const romBuffer = await romFile.arrayBuffer();
  fixRomByteOrder(romBuffer);
  const bytes = new Uint8Array(romBuffer);
  const header = new DataView(romBuffer);
  const country = header.getUint8(62);
  const id = generateRomId(header.getUint32(16), header.getUint32(20));
  const info = romdb[id];
  const rominfo = {
    id,
    name: info ? info.name : uint8ArrayReadString(bytes, 32, 20),
    cic: generateCICType(bytes),
    country: country || constants.countryNorthAmerica,
    tvType: country ? constants.tvTypeFromCountry(country) : constants.OS_TV_NTSC,
    save: info ? info.save : 'Eeprom4k',
  };
  return { romBuffer, rominfo };
}

export async function createHeadlessEmulator(loadedROM, {
  enableCompatibilityHacks = true,
  // Execute graphics display lists with NullRenderer when using HLE mode.
  // This updates HLE state and signals DP interrupts on FullSync without
  // producing pixels. The default skips lists and approximates one DP interrupt
  // per task, which can give incorrect guest scheduler behavior.
  executeGraphics = false,
  onHalt = () => {},
  onWarning = () => {},
  onCheckFailure = () => {},
  onVerticalBlank = null,
  onGraphicsTask = null,
  onAudioTask = null,
  onMicrocodeLoad = null,
  onTextureUse = null,
} = {}) {
  const [
    { simulateBoot },
    { ControllerInputs },,
    { Hardware },
    { Joybus },
    { initCPU },,
    { initRSP },,
    { HeadlessGraphics },
  ] = await loadModules();

  let cpu0 = null;
  let fatalError = null;
  const hardware = new Hardware(loadedROM.rominfo, { headless: true, enableCompatibilityHacks, onVerticalBlank, onGraphicsTask, onAudioTask, onMicrocodeLoad, onTextureUse });
  if (executeGraphics) {
    hardware.graphics = new HeadlessGraphics(hardware);
  }
  const inputs = Array.from({ length: 4 }, () => new ControllerInputs());
  const joybus = new Joybus(hardware, inputs);

  n64js.hardware = () => hardware;
  n64js.joybus = () => joybus;
  n64js.getLocalStorageItem = () => undefined;
  n64js.setLocalStorageItem = () => {};
  n64js.ui = () => ({ displayError() {}, displayWarning: onWarning });
  n64js.check = (condition, message) => {
    if (!condition) onCheckFailure(message);
  };
  n64js.warn = onWarning;
  n64js.stopForBreakpoint = () => cpu0?.breakExecution();
  n64js.halt = (message, details) => {
    fatalError = String(message);
    // Preserve the original thrown value for diagnostics without changing the
    // message consumed by existing headless callers.
    onHalt(fatalError, details);
    cpu0?.breakExecution();
  };
  n64js.returnControlToSystem = () => cpu0?.breakExecution();
  n64js.onPresent = () => {};
  n64js.breakpoints = () => ({ isBreakpoint: () => false, toggle() {} });

  // Short ROMs are expanded with ArrayBuffer.transfer, which detaches the
  // supplied buffer. Give every fresh emulator its own copy.
  hardware.createROM(loadedROM.romBuffer.slice(0));
  hardware.reset();
  initCPU(hardware);
  initRSP(hardware);
  hardware.loadROM();
  simulateBoot(hardware.cpu0, hardware, loadedROM.rominfo);
  cpu0 = hardware.cpu0;

  return {
    cpu0,
    hardware,
    // Live controller state shared with Joybus. Update fields on these objects
    // before running emulation; replacing an array entry won't rebind Joybus.
    inputs,
    fatalError: () => fatalError,
  };
}

export function runCycles(emulator, cycles, chunkCycles = 10_000_000) {
  const { cpu0 } = emulator;
  const target = cpu0.getOpsExecuted() + cycles;
  while (cpu0.getOpsExecuted() < target) {
    const remaining = target - cpu0.getOpsExecuted();
    cpu0.run(Math.min(chunkCycles, remaining));
    const fatalError = emulator.fatalError();
    if (fatalError) {
      throw new Error(fatalError);
    }
  }
  return cpu0.getOpsExecuted();
}

export function runFrames(emulator, frames, maxCycles, chunkCycles = 10_000_000) {
  const { cpu0, hardware } = emulator;
  const targetFrames = hardware.verticalBlankCount + frames;
  const cycleLimit = cpu0.getOpsExecuted() + maxCycles;
  while (hardware.verticalBlankCount < targetFrames) {
    const cyclesRemaining = cycleLimit - cpu0.getOpsExecuted();
    if (cyclesRemaining <= 0) {
      throw new Error(`Cycle limit reached before ${frames} VI retraces`);
    }
    cpu0.run(Math.min(chunkCycles, cyclesRemaining));
    const fatalError = emulator.fatalError();
    if (fatalError) {
      throw new Error(fatalError);
    }
  }
  return hardware.verticalBlankCount;
}
