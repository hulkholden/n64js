// Core modules currently publish a small API through window.n64js. In a
// headless runtime globalThis provides the equivalent shared namespace.
globalThis.window = globalThis;
globalThis.n64js ??= {};

let modulesPromise;

function loadModules() {
  modulesPromise ??= Promise.all([
    import('./boot.js'),
    import('./controllers.js'),
    import('./endian.js'),
    import('./hardware.js'),
    import('./joybus.js'),
    import('./r4300.js'),
    import('./romdb.js'),
    import('./rsp.js'),
    import('./system_constants.js'),
  ]);
  return modulesPromise;
}

export async function loadROMFile(romPath) {
  const [,, { fixRomByteOrder },,,, { generateCICType, uint8ArrayReadString },, constants] = await loadModules();
  const romFile = Bun.file(romPath);
  if (!await romFile.exists()) {
    throw new Error(`ROM not found: ${romPath}`);
  }

  const romBuffer = await romFile.arrayBuffer();
  fixRomByteOrder(romBuffer);
  const bytes = new Uint8Array(romBuffer);
  const country = new DataView(romBuffer).getUint8(62);
  const rominfo = {
    id: '',
    name: uint8ArrayReadString(bytes, 32, 20),
    cic: generateCICType(bytes),
    country: country || constants.countryNorthAmerica,
    tvType: country ? constants.tvTypeFromCountry(country) : constants.OS_TV_NTSC,
    save: 'Eeprom4k',
  };
  return { romBuffer, rominfo };
}

export async function createHeadlessEmulator(loadedROM) {
  const [
    { simulateBoot },
    { ControllerInputs },,
    { Hardware },
    { Joybus },
    { initCPU },,
    { initRSP },
  ] = await loadModules();

  let cpu0 = null;
  let fatalError = null;
  const hardware = new Hardware(loadedROM.rominfo, { headless: true });
  const inputs = Array.from({ length: 4 }, () => new ControllerInputs());
  const joybus = new Joybus(hardware, inputs);

  n64js.hardware = () => hardware;
  n64js.joybus = () => joybus;
  n64js.getLocalStorageItem = () => undefined;
  n64js.setLocalStorageItem = () => {};
  n64js.ui = () => ({ displayError() {}, displayWarning() {} });
  n64js.check = () => {};
  n64js.warn = () => {};
  n64js.stopForBreakpoint = () => cpu0?.breakExecution();
  n64js.halt = message => {
    fatalError = String(message);
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
