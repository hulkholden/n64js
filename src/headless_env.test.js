import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHeadlessEmulator, loadROMFile, runCycles, runFrames } from './headless_env.js';
import { controlCause, controlStatus } from './cpu0reg.js';
import { MI_INTR_DP, MI_INTR_MASK_REG, MI_INTR_REG, MI_INTR_VI } from './devices/mi.js';
import { SI_DRAM_ADDR_REG, SI_PIF_ADDR_RD64B_REG, SI_PIF_ADDR_WR64B_REG, SI_STATUS_REG } from './devices/si.js';
import { SP_CLR_BROKE, SP_CLR_HALT, SP_CLR_SIG2, SP_SET_HALT, SP_STATUS_REG, SP_STATUS_TASKDONE } from './devices/sp.js';
import { graphicsOptions } from './hle/graphics_options.js';
import { ImageFormat, ImageSize } from './hle/gbi.js';
import { MicrocodeId } from './hle/microcode_identifier.js';
import { TaskOffsets } from './hle/rsp_task.js';
import { OS_TV_NTSC } from './system_constants.js';

function createEmulator(options) {
  // Boot initialization only needs a buffer containing the bootstrap region.
  // Controller tests issue SI DMA requests directly, without running ROM code.
  return createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: OS_TV_NTSC, save: 'Eeprom4k' },
  }, options);
}

describe('headless ROM metadata', () => {
  test('loads cartridge save types from the database and accepts Doubutsu no Mori FlashRAM startup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'n64js-rom-metadata-'));
    try {
      for (const [crc1, crc2, expected] of [
        [0xbd8e206d, 0x98c35e1c, { id: '6d208ebd1c5ec398', name: 'Doubutsu No Mori', save: 'FlashRam' }],
        [0xb9ae9002, 0xc1b6a367, { id: '0290aeb967a3b6c1', name: 'Animal Forest', save: 'FlashRam' }],
        // A known cartridge with no save memory must retain that distinction.
        [0xdff227d9, 0x0d4d8169, { id: 'd927f2df69814d0d', name: "A Bug's Life", save: undefined }],
        [0, 0, { id: '0000000000000000', name: 'TEST', save: 'Eeprom4k' }],
      ]) {
        const bytes = new Uint8Array(0x1000);
        const header = new DataView(bytes.buffer);
        header.setUint32(0, 0x80371240);
        header.setUint32(16, crc1);
        header.setUint32(20, crc2);
        bytes.set(new TextEncoder().encode('TEST'), 32);
        bytes.set(new TextEncoder().encode('NAFJ'), 0x3b);
        const path = join(directory, 'synthetic.z64');
        await Bun.write(path, bytes);
        const loaded = await loadROMFile(path);
        expect(loaded.rominfo).toMatchObject(expected);
        if (expected.save === 'FlashRam') {
          const { hardware } = await createHeadlessEmulator(loaded);
          expect(hardware.saveMem.length).toBe(128 * 1024);
          // The game's first flash command previously threw "Writing s32 to rom".
          expect(() => hardware.romD2A2Device.write32(0xa8010000, 0xd2000000)).not.toThrow();
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

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

function prepareGraphicsTask(emulator) {
  const { hardware } = emulator;
  const version = 'RSP Gfx ucode F3DEX fifo 2.0';
  hardware.ram.u8.set([1, 2, 3], 0x1000);
  const data = new TextEncoder().encode(version + '\0');
  hardware.ram.u8.set(data, 0x2000);
  const task = hardware.sp_mem.subRegion(0xfc0, 0x40);
  task.set32(TaskOffsets.ucodePtr, 0x80001000);
  task.set32(TaskOffsets.ucodeSize, 3);
  task.set32(TaskOffsets.ucodeDataPtr, 0x80002000);
  task.set32(TaskOffsets.ucodeDataSize, data.length);
}

function startRSPTask(emulator, type = 1) {
  const { hardware } = emulator;
  hardware.sp_mem.set32(0xfc0 + TaskOffsets.type, type);
  const spStatusAddress = 0xa4040000 + SP_STATUS_REG;
  hardware.spRegDevice.write32(spStatusAddress, SP_SET_HALT | SP_CLR_BROKE | SP_CLR_SIG2);
  hardware.mi_reg.clearBits32(MI_INTR_REG, MI_INTR_DP);
  hardware.spRegDevice.write32(spStatusAddress, SP_CLR_HALT);
}

function setGraphicsCommands(emulator, commands) {
  const { hardware } = emulator;
  hardware.sp_mem.set32(0xfc0 + TaskOffsets.dataPtr, 0x3000);
  commands.forEach(([cmd0, cmd1], index) => {
    hardware.ram.set32(0x3000 + index * 8, cmd0);
    hardware.ram.set32(0x3004 + index * 8, cmd1);
  });
}

describe('headless graphics execution', () => {
  test('executes drawing commands and in-list microcode switches through SP dispatch', async () => {
    const seen = [];
    const emulator = await createEmulator({ executeGraphics: true, onGraphicsTask: info => seen.push(info) });
    const { hardware } = emulator;
    prepareGraphicsTask(emulator);

    // Use a 640x480 source image to exercise VI setup independently of the
    // native transform's default dimensions, without creating a canvas.
    hardware.vi_reg.set32(0x00, 2);
    hardware.vi_reg.set32(0x08, 640);
    hardware.vi_reg.set32(0x24, (108 << 16) | 748);
    hardware.vi_reg.set32(0x28, (34 << 16) | 514);
    hardware.vi_reg.set32(0x30, 0x400);
    hardware.vi_reg.set32(0x34, 0x800);

    const gbi1Data = new TextEncoder().encode('RSP Gfx ucode F3DEX 1.23\0');
    hardware.ram.u8.set(gbi1Data, 0x5000);
    for (let index = 0; index < 3; index++) {
      hardware.ram.dataView.setInt16(0x6000 + index * 16, index === 1 ? 1 : 0);
      hardware.ram.dataView.setInt16(0x6002 + index * 16, index === 2 ? 1 : 0);
      hardware.ram.set32(0x600c + index * 16, 0xffffffff);
    }
    const gbi2DataSize = hardware.sp_mem.getU32(0xfc0 + TaskOffsets.ucodeDataSize);
    setGraphicsCommands(emulator, [
      [0xf5000000 | (ImageFormat.G_IM_FMT_CI << 21) | (1 << 9), 0], // CI4 tile.
      [0x01003006, 0x6000], // GBI2: load vertices 0–2.
      [0x05000204, 0], // GBI2: draw a triangle.
      [0xe1000000, 0x80005000],
      [0xdd000000 | (gbi1Data.length - 1), 0x80004000], // Switch to GBI1.
      [0xbf000000, 0x00000204], // The replacement also needs the renderer.
      [0xb4000000, 0x80002000],
      [0xaf000000 | (gbi2DataSize - 1), 0x80001000], // Switch back to GBI2.
      [0x05000204, 0],
      [0xfa000000, 0x12345678],
      [0xdf000000, 0],
    ]);
    startRSPTask(emulator);

    const { state, renderer } = hardware.headlessGraphics;
    expect(state.projectedVertices.slice(0, 3).every(vertex => vertex.set)).toBe(true);
    expect(state.tiles[0]).toMatchObject({ format: ImageFormat.G_IM_FMT_CI, size: ImageSize.G_IM_SIZ_4b });
    expect(state.primColor).toBe(0x12345678);
    expect(state.pc).toBe(0);
    expect(renderer.nativeTransform).toMatchObject({ viWidth: 640, viHeight: 480 });
    expect(seen).toHaveLength(1); // The observer still reports only task starts.
    expect(seen[0].family).toBe('GBI2');
    expect(hardware.rsp.halted).toBe(true);
    expect(hardware.sp_reg.getU32(SP_STATUS_REG) & SP_STATUS_TASKDONE).toBe(SP_STATUS_TASKDONE);
    expect(hardware.mi_reg.getU32(MI_INTR_REG) & MI_INTR_DP).toBe(MI_INTR_DP);
  });

  test('starts each task afresh while preserving RDP state until hardware reset', async () => {
    const emulator = await createEmulator({ executeGraphics: true });
    prepareGraphicsTask(emulator);
    setGraphicsCommands(emulator, [[0xfa000000, 0x12345678], [0xdf000000, 0]]);
    startRSPTask(emulator);
    setGraphicsCommands(emulator, [[0xfb000000, 0xabcdef01], [0xdf000000, 0]]);
    startRSPTask(emulator);
    expect(emulator.hardware.headlessGraphics.state).toMatchObject({ primColor: 0x12345678, envColor: 0xabcdef01, pc: 0 });

    emulator.hardware.reset();
    prepareGraphicsTask(emulator);
    setGraphicsCommands(emulator, [[0xdf000000, 0]]);
    startRSPTask(emulator);
    expect(emulator.hardware.headlessGraphics.state).toMatchObject({ primColor: 0, envColor: 0, pc: 0 });

    setGraphicsCommands(emulator, [[0xfa000000, 0x87654321], [0xdf000000, 0]]);
    startRSPTask(emulator);
    const fresh = await createEmulator({ executeGraphics: true });
    expect(fresh.hardware.headlessGraphics.state.primColor).toBe(0);
    expect(emulator.hardware.headlessGraphics.state.primColor).toBe(0x87654321);
  });

  test('keeps default, LLE, and audio tasks out of headless HLE execution', async () => {
    const previousMode = graphicsOptions.emulationMode;
    try {
      for (const [options, mode, taskType] of [
        [{}, 'HLE', 1],
        [{ executeGraphics: true }, 'LLE', 1],
        [{ executeGraphics: true }, 'HLE', 2],
      ]) {
        graphicsOptions.emulationMode = mode;
        const emulator = await createEmulator(options);
        prepareGraphicsTask(emulator);
        // This would throw if the display-list runner tried to read it.
        emulator.hardware.sp_mem.set32(0xfc0 + TaskOffsets.dataPtr, 0x1000000);
        expect(() => startRSPTask(emulator, taskType)).not.toThrow();
        if (taskType === 1) {
          expect(emulator.hardware.rsp.halted).toBe(mode === 'HLE');
          expect(emulator.hardware.mi_reg.getU32(MI_INTR_REG) & MI_INTR_DP).toBe(mode === 'HLE' ? MI_INTR_DP : 0);
        }
      }
    } finally {
      graphicsOptions.emulationMode = previousMode;
    }
  });

  test('aborts a fatal HLE warning through the CPU halt path without completing the task', async () => {
    const previousHaltOnWarning = graphicsOptions.haltOnWarning;
    try {
      graphicsOptions.haltOnWarning = true;
      const halted = [];
      const emulator = await createEmulator({ executeGraphics: true, onHalt: message => halted.push(message) });
      const { cpu0, hardware } = emulator;
      prepareGraphicsTask(emulator);
      setGraphicsCommands(emulator, [[0x81000000, 0], [0xfa000000, 0x12345678], [0xdf000000, 0]]);
      hardware.sp_mem.set32(0xfc0 + TaskOffsets.type, 1);

      // Let guest code start the task so the actual CPU exception/halt handling
      // is exercised, rather than calling the processor directly.
      cpu0.pc = 0x80007000;
      cpu0.setControlU32(controlStatus, 0);
      cpu0.cop1ControlChanged();
      hardware.ram.set32(0x7000, 0x3c08a404); // lui t0, 0xa404
      hardware.ram.set32(0x7004, 0x24090000 | SP_CLR_HALT); // addiu t1, zero, SP_CLR_HALT
      hardware.ram.set32(0x7008, 0xad090000 | SP_STATUS_REG); // sw t1, SP_STATUS_REG(t0)

      expect(() => runCycles(emulator, 10)).toThrow(/Unknown display list op/);
      expect(halted).toHaveLength(1);
      expect(emulator.fatalError()).toBe(halted[0]);
      expect(hardware.headlessGraphics.state.primColor).toBe(0);
      expect(hardware.sp_reg.getU32(SP_STATUS_REG) & SP_STATUS_TASKDONE).toBe(0);
      expect(hardware.mi_reg.getU32(MI_INTR_REG) & MI_INTR_DP).toBe(0);
    } finally {
      graphicsOptions.haltOnWarning = previousHaltOnWarning;
    }
  });
});

describe('graphics task callback', () => {
  test('reports graphics starts before dispatch in both HLE and LLE without a renderer', async () => {
    const previousMode = graphicsOptions.emulationMode;
    try {
      for (const mode of ['HLE', 'LLE']) {
        graphicsOptions.emulationMode = mode;
        const seen = [];
        const emulator = await createEmulator({
          onGraphicsTask: info => {
            seen.push(info);
            expect(emulator.hardware.rsp.halted).toBe(true);
            expect(emulator.hardware.mi_reg.getU32(MI_INTR_REG) & MI_INTR_DP).toBe(0);
            return true; // Observers cannot claim a task was handled.
          },
        });
        const { hardware } = emulator;
        prepareGraphicsTask(emulator);
        startRSPTask(emulator);
        expect(seen).toEqual([{
          id: MicrocodeId.GBI2, family: 'GBI2', variant: null,
          version: 'RSP Gfx ucode F3DEX fifo 2.0', hash: 326, detection: 'string',
        }]);
        expect(hardware.rsp.halted).toBe(mode === 'HLE');
        expect(hardware.sp_reg.getU32(SP_STATUS_REG) & SP_STATUS_TASKDONE).toBe(mode === 'HLE' ? SP_STATUS_TASKDONE : 0);
        expect(hardware.mi_reg.getU32(MI_INTR_REG) & MI_INTR_DP).toBe(mode === 'HLE' ? MI_INTR_DP : 0);

        startRSPTask(emulator, 2); // Audio tasks are not graphics observations.
        expect(seen).toHaveLength(1);
      }
    } finally {
      graphicsOptions.emulationMode = previousMode;
    }
  });

  test('delivers independent snapshots on repeated starts and preserves the observer across reset', async () => {
    const seen = [];
    const emulator = await createEmulator({ onGraphicsTask: info => seen.push(info) });
    prepareGraphicsTask(emulator);
    startRSPTask(emulator);
    startRSPTask(emulator);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual(seen[1]);
    expect(seen[0]).not.toBe(seen[1]);
    const original = { ...seen[1] };
    seen[0].family = 'changed by observer';

    // Guest memory changes must not change previously collected observations.
    emulator.hardware.ram.u8.fill(0, 0x1000, 0x2040);
    startRSPTask(emulator);
    expect(seen[2]).toMatchObject({ version: '', hash: 0, detection: 'fallback' });
    expect(seen[1]).toEqual(original);

    emulator.hardware.reset();
    prepareGraphicsTask(emulator);
    startRSPTask(emulator);
    expect(seen).toHaveLength(4);
    expect(seen[3]).toEqual(original);
  });

  test('keeps observation optional and scoped to the hardware instance', async () => {
    const seen = [];
    const first = await createEmulator({ onGraphicsTask: info => seen.push(info) });
    prepareGraphicsTask(first);
    startRSPTask(first);

    const second = await createEmulator();
    prepareGraphicsTask(second);
    startRSPTask(second);
    expect(seen).toHaveLength(1);
    expect(second.hardware.sp_reg.getU32(SP_STATUS_REG) & SP_STATUS_TASKDONE).toBe(SP_STATUS_TASKDONE);
    expect(second.hardware.mi_reg.getU32(MI_INTR_REG) & MI_INTR_DP).toBe(MI_INTR_DP);
  });
});
