#!/usr/bin/env bun

// Core modules currently publish a small API through window.n64js. In a
// headless runtime globalThis provides the equivalent shared namespace.
globalThis.window = globalThis;
globalThis.n64js = {};

const defaultRomPath = '/Users/paulholden/dev/github.com/thelemmy/nemu64-test/target/mips-nintendo64-none/release/n64-systemtest.z64';
const romPath = Bun.argv[2] ?? defaultRomPath;
const maxCycles = Number(Bun.argv[3] ?? 5_000_000_000);
const cyclesPerRun = 100_000_000;

if (!Number.isSafeInteger(maxCycles) || maxCycles <= 0) {
  console.error(`Invalid cycle limit: ${Bun.argv[3]}`);
  process.exit(2);
}

let cpu0 = null;
let fatalError = null;
let result = null;

const originalLog = console.log.bind(console);
console.log = (...args) => {
  originalLog(...args);
  const line = args.map(String).join(' ');
  const match = line.match(/Done! Tests:\s*(\d+)\. Failed:\s*(\d+)/);
  if (match) {
    result = { tests: Number(match[1]), failed: Number(match[2]) };
    cpu0?.breakExecution();
  }
};

try {
  const [
    { simulateBoot },
    { ControllerInputs },
    { fixRomByteOrder },
    { Hardware },
    { Joybus },
    { initCPU },
    { generateCICType, uint8ArrayReadString },
    { initRSP },
    { countryNorthAmerica, OS_TV_NTSC, tvTypeFromCountry },
  ] = await Promise.all([
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

  const romFile = Bun.file(romPath);
  if (!await romFile.exists()) {
    throw new Error(`ROM not found: ${romPath}`);
  }

  const romBuffer = await romFile.arrayBuffer();
  fixRomByteOrder(romBuffer);

  const header = new DataView(romBuffer);
  const country = header.getUint8(62);
  const rominfo = {
    id: '',
    name: uint8ArrayReadString(new Uint8Array(romBuffer), 32, 20),
    cic: generateCICType(new Uint8Array(romBuffer)),
    country: country || countryNorthAmerica,
    tvType: country ? tvTypeFromCountry(country) : OS_TV_NTSC,
    save: 'Eeprom4k',
  };

  const hardware = new Hardware(rominfo, { headless: true });
  const inputs = Array.from({ length: 4 }, () => new ControllerInputs());
  const joybus = new Joybus(hardware, inputs);

  n64js.hardware = () => hardware;
  n64js.joybus = () => joybus;
  n64js.getLocalStorageItem = () => undefined;
  n64js.setLocalStorageItem = () => {};
  n64js.ui = () => ({ displayError() {}, displayWarning(message) { console.error(message); } });
  n64js.check = (condition, message) => { if (!condition) console.error(message); };
  n64js.warn = message => console.error(message);
  n64js.stopForBreakpoint = () => cpu0?.breakExecution();
  n64js.halt = message => {
    fatalError = String(message);
    console.error(fatalError);
    cpu0?.breakExecution();
  };
  n64js.returnControlToSystem = () => cpu0?.breakExecution();
  n64js.onPresent = () => {};
  n64js.breakpoints = () => ({ isBreakpoint: () => false, toggle() {} });

  hardware.createROM(romBuffer);
  hardware.reset();
  initCPU(hardware);
  initRSP(hardware);
  hardware.loadROM();
  simulateBoot(hardware.cpu0, hardware, rominfo);
  cpu0 = hardware.cpu0;

  console.error(`Running ${rominfo.name || romPath} (${rominfo.cic}) headlessly`);

  while (!result && !fatalError && cpu0.getOpsExecuted() < maxCycles) {
    const remaining = maxCycles - cpu0.getOpsExecuted();
    cpu0.run(Math.min(cyclesPerRun, remaining));
    // Give Bun an opportunity to deliver signals between emulation frames.
    await Bun.sleep(0);
  }

  if (fatalError) {
    process.exitCode = 2;
  } else if (!result) {
    console.error(`Timed out after ${cpu0.getOpsExecuted()} cycles`);
    process.exitCode = 3;
  } else {
    console.error(`Completed ${result.tests} tests with ${result.failed} failures`);
    process.exitCode = result.failed === 0 ? 0 : 1;
  }
} catch (error) {
  console.error(error?.stack ?? error);
  process.exitCode = 2;
}
