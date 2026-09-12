import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator, runCycles, runFrames } from './headless_env.js';
import { controlCause, controlStatus } from './cpu0reg.js';
import { MI_INTR_MASK_REG, MI_INTR_REG, MI_INTR_VI } from './devices/mi.js';
import { SI_DRAM_ADDR_REG, SI_PIF_ADDR_RD64B_REG, SI_PIF_ADDR_WR64B_REG, SI_STATUS_REG } from './devices/si.js';
import { OS_TV_NTSC } from './system_constants.js';

function createEmulator(options) {
  // Boot initialization only needs a buffer containing the bootstrap region.
  // Controller tests issue SI DMA requests directly, without running ROM code.
  return createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: OS_TV_NTSC, save: 'Eeprom4k' },
  }, options);
}

function readController(emulator, port = 0) {
  const { hardware } = emulator;
  const dramAddress = 0x1000;
  const siBase = 0xa4800000;
  const pifAddress = 0x1fc007c0;
  const frame = hardware.ram.u8.subarray(dramAddress, dramAddress + 64);
  frame.fill(0);
  // Leading zero bytes skip earlier ports. Send command 1 (controller read),
  // reserve four response bytes, then terminate the Joybus command list.
  frame.set([1, 4, 1, 0, 0, 0, 0, 0xfe], port);
  frame[63] = 1;

  const si = hardware.siRegDevice;
  si.write32(siBase + SI_DRAM_ADDR_REG, dramAddress);
  si.write32(siBase + SI_PIF_ADDR_WR64B_REG, pifAddress);
  si.write32(siBase + SI_STATUS_REG, 0);
  si.write32(siBase + SI_PIF_ADDR_RD64B_REG, pifAddress);
  si.write32(siBase + SI_STATUS_REG, 0);
  return {
    status: frame[port + 1],
    data: Array.from(frame.subarray(port + 3, port + 7)),
  };
}

describe('headless controller input', () => {
  test('starts neutral and keeps additional controller ports disconnected', async () => {
    const emulator = await createEmulator();
    expect(emulator.inputs).toHaveLength(4);
    expect(readController(emulator)).toEqual({ status: 4, data: [0, 0, 0, 0] });

    for (let port = 1; port < 4; port++) {
      emulator.inputs[port].buttons = 0x8000;
      // The high bit reports that the disconnected port returned no data.
      expect(readController(emulator, port).status).toBe(0x84);
    }
    expect(readController(emulator)).toEqual({ status: 4, data: [0, 0, 0, 0] });
  });

  test('delivers button presses, holds, releases, and signed stick positions through SI DMA', async () => {
    const emulator = await createEmulator();
    const controller = emulator.inputs[0];
    controller.buttons = 0x9001; // Start, A, and C-right exercise both button bytes.
    controller.stick_x = -80;
    controller.stick_y = 80;
    const pressed = { status: 4, data: [0x90, 0x01, 0xb0, 0x50] };
    expect(readController(emulator)).toEqual(pressed);
    expect(readController(emulator)).toEqual(pressed);

    controller.buttons = 0;
    controller.stick_x = 0;
    controller.stick_y = 0;
    expect(readController(emulator)).toEqual({ status: 4, data: [0, 0, 0, 0] });
    expect(emulator.fatalError()).toBeNull();
  });

  test('allocates fresh controller state for each emulator', async () => {
    const first = await createEmulator();
    for (const input of first.inputs) {
      input.buttons = 0x1000;
      input.stick_x = -80;
      input.stick_y = 80;
    }

    const second = await createEmulator();
    for (const input of second.inputs) {
      expect(input).toMatchObject({ buttons: 0, stick_x: 0, stick_y: 0 });
    }
    expect(readController(second)).toEqual({ status: 4, data: [0, 0, 0, 0] });
    expect(first.inputs[0]).toMatchObject({ buttons: 0x1000, stick_x: -80, stick_y: 80 });
  });
});

function rtcROM(gameCode = 'NAF', flags = 0) {
  const romBuffer = new ArrayBuffer(0x1000);
  const bytes = new Uint8Array(romBuffer);
  bytes.set(new TextEncoder().encode(gameCode), 0x3b);
  bytes[0x3f] = flags;
  return { romBuffer, rominfo: { cic: '6102', tvType: OS_TV_NTSC, save: 'FlashRam' } };
}

function rtcCommand(emulator, command, rx) {
  const { hardware } = emulator;
  const frame = hardware.ram.u8.subarray(0x1000, 0x1040);
  frame.fill(0);
  // Match libdragon's status packet padding so its response is 8-byte aligned.
  const channel = command[0] === 0x06 ? 5 : 4;
  if (channel === 5) { frame[4] = 0xff; }
  frame.set([command.length, rx, ...command], channel);
  const start = channel + 2 + command.length;
  frame.fill(0xff, start, start + rx);
  frame[start + rx] = 0xfe;
  frame[63] = 1;

  const si = hardware.siRegDevice;
  si.write32(0xa4800000 + SI_DRAM_ADDR_REG, 0x1000);
  si.write32(0xa4800000 + SI_PIF_ADDR_WR64B_REG, 0x1fc007c0);
  si.write32(0xa4800000 + SI_STATUS_REG, 0);
  si.write32(0xa4800000 + SI_PIF_ADDR_RD64B_REG, 0x1fc007c0);
  si.write32(0xa4800000 + SI_STATUS_REG, 0);
  return { status: frame[channel + 1], data: [...frame.slice(start, start + rx)] };
}

describe('cartridge RTC hardware integration', () => {
  for (const [code, flags, present] of [
    ['NAF', 0, true], ['NED', 1, true], ['NED', 0x11, true],
    ['NED', 0x10, false], ['NSM', 1, false],
  ]) {
    test(`header ${code} flags ${flags} reports RTC presence ${present} through SI DMA`, async () => {
      const emulator = await createHeadlessEmulator(rtcROM(code, flags));
      expect(rtcCommand(emulator, [0x06], 3)).toEqual(present ?
        { status: 3, data: [0, 0x10, 0] } : { status: 0x83, data: [0xff, 0xff, 0xff] });
    });
  }

  test('uses the injected clock, preserves it across reset, and detaches it on cartridge change', async () => {
    let now = new Date(2024, 0, 1).getTime();
    const emulator = await createHeadlessEmulator(rtcROM(), { rtcNow: () => now });
    expect(rtcCommand(emulator, [0x07, 2], 9).data).toEqual([0, 0, 0x80, 1, 1, 1, 0x24, 1, 0]);
    rtcCommand(emulator, [0x08, 0, 0, 4, 0, 0, 0, 0, 0, 0], 1);
    const time = [0x03, 0x02, 0x81, 0x03, 1, 0x11, 0x03, 1];
    expect(rtcCommand(emulator, [0x08, 2, ...time], 1)).toEqual({ status: 1, data: [0x80] });
    emulator.hardware.reset();
    now += 60_000;
    expect(rtcCommand(emulator, [0x07, 2], 9).data).toEqual([...time, 0x80]);
    rtcCommand(emulator, [0x08, 0, 3, 0, 0, 0, 0, 0, 0, 0], 1);
    now += 1000;
    expect(rtcCommand(emulator, [0x07, 2], 9).data).toEqual([0x04, ...time.slice(1), 0]);

    emulator.hardware.createROM(rtcROM('NSM').romBuffer);
    emulator.hardware.reset();
    expect(emulator.hardware.rtc).toBeNull();
    expect(rtcCommand(emulator, [0x06], 3).status).toBe(0x83);
  });

  test('flushes RTC writes to separate storage and restores them when the ROM is reloaded', async () => {
    let now = new Date(2024, 0, 1).getTime();
    const emulator = await createHeadlessEmulator(rtcROM(), { rtcNow: () => now });
    const items = new Map();
    let rtcSaves = 0;
    const originalGet = n64js.getLocalStorageItem;
    const originalSet = n64js.setLocalStorageItem;
    n64js.getLocalStorageItem = name => items.get(name);
    n64js.setLocalStorageItem = (name, item) => {
      items.set(name, JSON.parse(JSON.stringify(item)));
      if (name === 'rtc') { rtcSaves++; }
    };
    try {
      rtcCommand(emulator, [0x08, 0, 0, 4, 0, 0, 0, 0, 0, 0], 1);
      const time = [0x03, 0x02, 0x81, 0x03, 1, 0x11, 0x03, 1];
      rtcCommand(emulator, [0x08, 2, ...time], 1);
      rtcCommand(emulator, [0x08, 0, 3, 0, 0, 0, 0, 0, 0, 0], 1);
      emulator.hardware.flushSaveData();
      expect(items.has('rtc')).toBe(true);
      expect(items.has('save')).toBe(false);
      expect(rtcSaves).toBe(1);
      now += 1000;
      rtcCommand(emulator, [0x07, 2], 9);
      emulator.hardware.flushSaveData();
      expect(rtcSaves).toBe(1);

      now += 1000;
      emulator.hardware.createROM(rtcROM().romBuffer);
      emulator.hardware.reset();
      expect(rtcCommand(emulator, [0x07, 2], 9).data).toEqual([0x05, ...time.slice(1), 0]);
    } finally {
      n64js.getLocalStorageItem = originalGet;
      n64js.setLocalStorageItem = originalSet;
    }
  });
});

function prepareVIEmulation(emulator) {
  const { cpu0, hardware } = emulator;
  // Execute NOPs from cleared RAM, with guest interrupts disabled. Use a short
  // synthetic VI interval while exercising the real CPU and VI event handling.
  cpu0.pc = 0x80000000;
  cpu0.setControlU32(controlStatus, 0);
  cpu0.cop1ControlChanged();
  hardware.vi_reg.set32(0, 0x40); // Interlaced, so the field toggles each VI.
  hardware.mi_reg.set32(MI_INTR_MASK_REG, MI_INTR_VI);
  cpu0.updateCause3();
  hardware.viRegDevice.countPerVbl = 8;
  hardware.viRegDevice.addInterruptEvent();
}

describe('VI boundary callback', () => {
  test('runs once per VI after the counter, field, and interrupt state are updated', async () => {
    const seen = [];
    const emulator = await createEmulator({
      onVerticalBlank: count => {
        const { cpu0, hardware } = emulator;
        seen.push({
          count,
          actualCount: hardware.verticalBlankCount,
          field: hardware.viRegDevice.field,
          pending: hardware.mi_reg.getU32(MI_INTR_REG) & MI_INTR_VI,
          cause: cpu0.getControlU32(controlCause) & 0x400,
          nextVI: hardware.viRegDevice.getVblCount(),
        });
      },
    });
    prepareVIEmulation(emulator);
    runCycles(emulator, 7);
    expect(seen).toEqual([]);
    runCycles(emulator, 1);
    expect(seen).toEqual([
      { count: 1, actualCount: 1, field: 1, pending: MI_INTR_VI, cause: 0x400, nextVI: 8 },
    ]);
    runCycles(emulator, 8);
    expect(seen).toEqual([
      { count: 1, actualCount: 1, field: 1, pending: MI_INTR_VI, cause: 0x400, nextVI: 8 },
      { count: 2, actualCount: 2, field: 0, pending: MI_INTR_VI, cause: 0x400, nextVI: 8 },
    ]);
  });

  test('updates input before subsequent polls with either runner and different chunk sizes', async () => {
    for (const frames of [false, true]) {
      for (const chunkCycles of [1, 3, 100]) {
        const samples = [];
        const emulator = await createEmulator({
          onVerticalBlank: count => {
            emulator.inputs[0].buttons = count % 2 ? 0x1000 : 0;
            // Poll through SI DMA one emulated cycle after each VI boundary.
            emulator.cpu0.addEvent('Test controller poll', 1, () => {
              samples.push(readController(emulator).data);
            });
          },
        });
        prepareVIEmulation(emulator);
        if (frames) {
          runFrames(emulator, 3, 24, chunkCycles);
        } else {
          runCycles(emulator, 24, chunkCycles);
        }
        runCycles(emulator, 1); // Deliver the final scheduled poll.
        expect(samples).toEqual([[0x10, 0, 0, 0], [0, 0, 0, 0], [0x10, 0, 0, 0]]);
        expect(emulator.hardware.verticalBlankCount).toBe(3);
      }
    }
  });

  test('preserves the callback across reset and restarts the VI count', async () => {
    const seen = [];
    const emulator = await createEmulator({ onVerticalBlank: count => seen.push(count) });
    prepareVIEmulation(emulator);
    runFrames(emulator, 2, 16);
    emulator.hardware.reset();
    expect(emulator.hardware.verticalBlankCount).toBe(0);
    expect(seen).toEqual([1, 2]);
    prepareVIEmulation(emulator);
    runFrames(emulator, 1, 8);
    expect(seen).toEqual([1, 2, 1]);
  });

  test('keeps the callback optional and scoped to its hardware instance', async () => {
    const seen = [];
    const first = await createEmulator({ onVerticalBlank: count => seen.push(count) });
    prepareVIEmulation(first);
    runFrames(first, 1, 8);

    const second = await createEmulator();
    prepareVIEmulation(second);
    expect(runFrames(second, 2, 16)).toBe(2);
    expect(seen).toEqual([1]);
  });
});
