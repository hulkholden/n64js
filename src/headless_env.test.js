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
