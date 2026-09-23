import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator, runCycles, runFrames } from './headless_env.js';
import { controlCause, controlStatus } from '../cpu/cpu0reg.js';
import { MI_INTR_DP, MI_INTR_MASK_REG, MI_INTR_REG, MI_INTR_SP, MI_INTR_VI } from '../devices/mi.js';
import { SI_DRAM_ADDR_REG, SI_PIF_ADDR_RD64B_REG, SI_PIF_ADDR_WR64B_REG, SI_STATUS_REG } from '../devices/si.js';
import { SP_CLR_BROKE, SP_CLR_HALT, SP_CLR_SIG2, SP_SET_HALT, SP_SET_INTR_BREAK, SP_STATUS_HALT, SP_STATUS_BROKE, SP_STATUS_REG, SP_STATUS_TASKDONE } from '../devices/sp.js';
import { audioOptions } from '../hle/audio_options.js';
import { graphicsOptions } from '../hle/graphics_options.js';
import { ImageFormat, ImageSize } from '../hle/gbi.js';
import { MicrocodeId } from '../hle/microcode_identifier.js';
import { TaskOffsets } from '../hle/rsp_task.js';
import { OS_TV_NTSC } from '../system_constants.js';

const { getFragmentMap } = await import('../cpu/fragments.js');

function createEmulator(options) {
  // Boot initialization only needs a buffer containing the bootstrap region.
  // Controller tests issue SI DMA requests directly, without running ROM code.
  return createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: OS_TV_NTSC, save: 'Eeprom4k' },
  }, options);
}

function readController(emulator, port = 0, onRead = null) {
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
  return afterDMA(() => {
    si.write32(siBase + SI_STATUS_REG, 0);
    si.write32(siBase + SI_PIF_ADDR_RD64B_REG, pifAddress);
    return afterDMA(() => {
      si.write32(siBase + SI_STATUS_REG, 0);
      const result = {
        status: frame[port + 1],
        data: Array.from(frame.subarray(port + 3, port + 7)),
      };
      if (onRead) onRead(result);
      return result;
    });
  });

  function afterDMA(next) {
    // Poll after completion; callbacks used inside a running CPU must not
    // advance its event queue recursively.
    if (onRead) return emulator.cpu0.addEvent('Test SI completion', 0x901, next);
    emulator.cpu0.incrementCount(0x900);
    emulator.cpu0.eventQueue.incrementCount(0x900);
    return next();
  }
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

function prepareVIEmulation(emulator, interval = 8) {
  const { cpu0, hardware } = emulator;
  // Execute NOPs from cleared RAM, with guest interrupts disabled. Use a short
  // synthetic VI interval while exercising the real CPU and VI event handling.
  cpu0.pc = 0x80000000;
  cpu0.setControlU32(controlStatus, 0);
  cpu0.cop1ControlChanged();
  hardware.vi_reg.set32(0, 0x40); // Interlaced, so the field toggles each VI.
  hardware.mi_reg.set32(MI_INTR_MASK_REG, MI_INTR_VI);
  cpu0.updateCause3();
  hardware.viRegDevice.countPerVbl = interval;
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
              readController(emulator, 0, result => samples.push(result.data));
            });
          },
        });
        // Leave time for both SI transfers between VI boundaries.
        prepareVIEmulation(emulator, 0x2000);
        if (frames) {
          runFrames(emulator, 3, 0x6000, chunkCycles);
        } else {
          runCycles(emulator, 0x6000, chunkCycles);
        }
        runCycles(emulator, 0x1203); // Finish the final scheduled poll's DMAs.
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

function prepareGraphicsTask(emulator, version = 'RSP Gfx ucode F3DEX fifo 2.0', code = [1, 2, 3]) {
  const { hardware } = emulator;
  hardware.ram.u8.set(code, 0x1000);
  const data = new TextEncoder().encode(version + '\0');
  hardware.ram.u8.set(data, 0x2000);
  const task = hardware.sp_mem.subRegion(0xfc0, 0x40);
  task.set32(TaskOffsets.ucodePtr, 0x80001000);
  task.set32(TaskOffsets.ucodeSize, code.length);
  task.set32(TaskOffsets.ucodeDataPtr, 0x80002000);
  task.set32(TaskOffsets.ucodeDataSize, data.length);
}

function startRSPTask(emulator, type = 1) {
  const { hardware } = emulator;
  hardware.sp_mem.set32(0xfc0 + TaskOffsets.type, type);
  const spStatusAddress = 0xa4040000 + SP_STATUS_REG;
  hardware.spRegDevice.write32(spStatusAddress, SP_SET_HALT | SP_CLR_BROKE | SP_CLR_SIG2);
  // Discard any interrupt from halting the RSP during setup.
  hardware.mi_reg.clearBits32(MI_INTR_REG, MI_INTR_DP | MI_INTR_SP);
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

// Synthetic bytes with hash 0xe281945c, not game microcode. Leading zeros keep
// the hash unchanged and exercise the 4 KiB size used by in-list microcode loads.
const bossCode = new Uint8Array(0x1000);
bossCode.set([9, 4, 7, 7, 4, 4, 9, 0], bossCode.length - 8);
// Synthetic bytes with hash 0xc62a1631, likewise not game microcode.
const rogueCode = new Uint8Array(0x1000);
rogueCode.set([8, 1, 12, 9, 2, 0, 12, 5], rogueCode.length - 8);
const unsupportedMicrocodes = [
  { family: 'F5', version: '', code: rogueCode, detection: 'hash' },
  { family: 'ZSortp', version: 'RSP Gfx ucode ZSortp 0.33 Yoshitaka Yasumoto Nintendo.', code: [1, 2, 3], detection: 'string' },
  { family: 'ZSortBOSS', version: '', code: bossCode, detection: 'hash' },
];

describe('headless graphics execution', () => {
  test('reports runaway display lists as fatal errors without fabricating SP or DP completion', async () => {
    const halted = [];
    const emulator = await createEmulator({
      executeGraphics: true,
      onHalt: (message, details) => halted.push({ message, details }),
    });
    const { cpu0, hardware } = emulator;
    prepareGraphicsTask(emulator);
    // Two branches evade the intentional single-command producer-wait check.
    setGraphicsCommands(emulator, [[0xde010000, 0x3008], [0xde010000, 0x3000]]);
    hardware.sp_mem.set32(0xfc0 + TaskOffsets.type, 1);
    hardware.spRegDevice.write32(0xa4040000 + SP_STATUS_REG, SP_SET_INTR_BREAK);
    cpu0.pc = 0x80007000;
    cpu0.setControlU32(controlStatus, 0);
    cpu0.cop1ControlChanged();
    hardware.ram.set32(0x7000, 0x3c08a404); // LUI t0, 0xa404
    hardware.ram.set32(0x7004, 0x24090000 | SP_CLR_HALT);
    hardware.ram.set32(0x7008, 0xad090000 | SP_STATUS_REG);

    expect(() => runCycles(emulator, 10)).toThrow('HLE display-list command limit');
    expect(halted).toHaveLength(1);
    expect(halted[0].details.error.name).toBe('DisplayListLimitError');
    expect(halted[0].details.error.message).toContain('1000000');
    expect(hardware.sp_reg.getU32(SP_STATUS_REG) & (SP_STATUS_TASKDONE | SP_STATUS_BROKE)).toBe(0);
    expect(hardware.mi_reg.getU32(MI_INTR_REG) & (MI_INTR_DP | MI_INTR_SP)).toBe(0);
    expect(hardware.spRegDevice.hleTask).toBeNull();
  });

  test('completes SP-only lists without reporting an extra DP completion', async () => {
    const emulator = await createEmulator({ executeGraphics: true });
    const { hardware } = emulator;
    prepareGraphicsTask(emulator);
    // Griffey splits a frame over tasks: the first finishes without FullSync,
    // and the next requests DP completion. A DP interrupt on the first task
    // makes its scheduler consume the next task's pointer prematurely.
    let dp = 0;
    hardware.miRegDevice.interruptDP = () => { dp++; };
    for (const [fullSync, expected] of [[false, 0], [true, 1], [false, 1]]) {
      setGraphicsCommands(emulator, [
        [0xe7000000, 0], // PipeSync is not a DP interrupt.
        ...(fullSync ? [[0xe9000000, 0]] : []),
        [0xdf000000, 0],
        [0xe9000000, 0], // Unreachable commands must not signal completion.
      ]);
      startRSPTask(emulator);
      const complete = SP_STATUS_TASKDONE | SP_STATUS_BROKE | SP_STATUS_HALT;
      expect(hardware.sp_reg.getU32(SP_STATUS_REG) & complete).toBe(complete);
      expect(dp).toBe(expected);
      expect(hardware.dpcDevice.readU32(0xa4100010)).toBe(expected);
    }
    expect(dp).toBe(1);
  });

  test('completes SP work while DP is frozen and delivers FullSync after unfreeze', async () => {
    const emulator = await createEmulator({ executeGraphics: true });
    const { hardware } = emulator;
    prepareGraphicsTask(emulator);
    setGraphicsCommands(emulator, [[0xe9000000, 0], [0xdf000000, 0]]);
    hardware.dpcDevice.write32(0xa410000c, 0x8); // SET_FREEZE
    startRSPTask(emulator);
    const complete = SP_STATUS_TASKDONE | SP_STATUS_BROKE | SP_STATUS_HALT;
    expect(hardware.sp_reg.getU32(SP_STATUS_REG) & complete).toBe(complete);
    expect(hardware.mi_reg.getU32(MI_INTR_REG) & MI_INTR_DP).toBe(0);
    hardware.dpcDevice.write32(0xa410000c, 0x4); // CLR_FREEZE
    expect(hardware.mi_reg.getU32(MI_INTR_REG) & MI_INTR_DP).toBe(MI_INTR_DP);
  });

  test('keeps the ECW/WWF counter conversion and division finite in interpreted and compiled loops', async () => {
    const emulator = await createEmulator({ executeGraphics: true });
    const { cpu0, hardware } = emulator;
    prepareGraphicsTask(emulator);
    setGraphicsCommands(emulator, [[0xe9000000, 0], [0xdf000000, 0]]);
    startRSPTask(emulator);

    // These games divide profiling measurements by the DP clock counter after
    // their first completed list. A permanently zero clock raises Invalid.
    const program = [
      0x3c08a410, // LUI t0, 0xa410
      0x8d030010, // LW v1, DPC_CLOCK(t0)
      0x44831000, // MTC1 v1, f2
      0x468010a1, // CVT.D.W f2, f2
      0x04620001, // BLTZL v1, +1
      0x46341080, // ADD.D f2, f2, f20 (annulled for a nonnegative counter)
      0x46220003, // DIV.D f0, f0, f2
      0x08001c00, // J 0x80007000
      0x00000000,
    ];
    program.forEach((word, i) => hardware.ram.set32(0x7000 + i * 4, word));
    cpu0.pc = 0x80007000;
    cpu0.setControlU32(controlStatus, 0x20000000); // CU1, interrupts disabled.
    cpu0.clearControlBits32(controlCause, 0x7c);
    cpu0.cop1ControlChanged();
    hardware.cpu1.control[31] = 0x01000800; // Invalid operation enabled.
    hardware.cpu1.regF64[hardware.cpu1.fsRegIdx64(0)] = 0;
    hardware.cpu1.regF64[hardware.cpu1.fsRegIdx64(20)] = 4294967296;
    for (const cycles of [8, 16000]) {
      runCycles(emulator, cycles);
      expect(cpu0.pc).toBe(0x80007000);
      expect(hardware.cpu1.loadF64(0)).toBe(0);
      expect(hardware.cpu1.loadF64(hardware.cpu1.fsRegIdx64(2))).toBe(1);
      expect(hardware.cpu1.control[31]).toBe(0x01000800);
      expect(cpu0.getControlU32(controlCause) & 0x7c).toBe(0);
    }
    expect(getFragmentMap().get(0x80007000)?.executionCount).toBeGreaterThan(0);

    // A zero counter must still take the enabled Invalid exception.
    hardware.dpcDevice.write32(0xa410000c, 0x200);
    cpu0.run(6);
    expect(cpu0.pc).toBe(0x80000180);
    expect(cpu0.getControlU32(controlCause) & 0x7c).toBe(15 << 2);
    expect(hardware.cpu1.control[31]).toBe(0x01010800);
  });

  test.each(unsupportedMicrocodes)('rejects $family tasks and in-list loads before parsing their commands', async ({ family, version, code, detection }) => {
    const previousHaltOnWarning = graphicsOptions.haltOnWarning;
    try {
      // Unsupported execution must stop even when ordinary warnings are ignored.
      graphicsOptions.haltOnWarning = false;
      for (const inList of [false, true]) {
        const seen = [];
        const loaded = [];
        const halted = [];
        const emulator = await createEmulator({
          executeGraphics: true,
          onGraphicsTask: info => seen.push(info),
          onMicrocodeLoad: info => loaded.push(info),
          onHalt: (message, details) => halted.push({ message, details }),
        });
        const { cpu0, hardware } = emulator;
        prepareGraphicsTask(emulator, inList ? undefined : version, inList ? undefined : code);
        const data = new TextEncoder().encode(version + '\0');
        hardware.ram.u8.set(data, 0x5000);
        hardware.ram.u8.set(code, 0x4000);
        setGraphicsCommands(emulator, [
          ...(inList ? [[0xe1000000, 0x80005000], [0xdd000000 | (data.length - 1), 0x80004000]] : []),
          // The observed ZSortp startup sequence. GBI0 ignores even its end.
          [0xdb000806, 0x80008000],
          [0x81000000, 0x80006000],
          [0x81000000, 0x80006008],
          [0xdf000000, 0],
          // A canary past the end: the fallback would continue and execute it.
          [0xfa000000, 0x12345678],
          [0xb8000000, 0],
        ]);
        hardware.sp_mem.set32(0xfc0 + TaskOffsets.type, 1);
        cpu0.pc = 0x80007000;
        cpu0.setControlU32(controlStatus, 0);
        cpu0.cop1ControlChanged();
        hardware.ram.set32(0x7000, 0x3c08a404); // lui t0, 0xa404
        hardware.ram.set32(0x7004, 0x24090000 | SP_CLR_HALT);
        hardware.ram.set32(0x7008, 0xad090000 | SP_STATUS_REG);

        expect(() => runCycles(emulator, 10)).toThrow(`Unsupported graphics microcode: ${family}`);
        expect(halted).toHaveLength(1);
        expect(halted[0].details.error).toMatchObject({ name: 'UnsupportedMicrocodeError' });
        expect(halted[0].details.error.message).toContain(version);
        expect(halted[0].details.error.message).toContain('hash');
        expect(halted[0].details.error.message).toContain('HLE is not implemented');
        if (family === 'ZSortBOSS') expect(halted[0].details.error.message).toContain('0xe281945c');
        expect(seen.map(info => info.family)).toEqual([inList ? 'GBI2' : family]);
        expect(seen[0].detection).toBe(inList ? 'string' : detection);
        expect(loaded.map(info => info.family)).toEqual(inList ? ['GBI2'] : []);
        expect(hardware.graphics.state.primColor).toBe(0);
        expect(hardware.graphics.state.currentOp).toBe(inList ? 1 : 0);
        expect(hardware.sp_reg.getU32(SP_STATUS_REG) & (SP_STATUS_TASKDONE | SP_STATUS_BROKE)).toBe(0);
        expect(hardware.mi_reg.getU32(MI_INTR_REG) & (MI_INTR_DP | MI_INTR_SP)).toBe(0);
        expect(hardware.spRegDevice.hleTask).toBeNull();
      }
    } finally {
      graphicsOptions.haltOnWarning = previousHaltOnWarning;
    }
  });

  test.each(unsupportedMicrocodes)('does not fabricate completion for $family when headless display lists are skipped', async ({ family, version, code, detection }) => {
    const seen = [];
    const emulator = await createEmulator({ onGraphicsTask: info => seen.push(info) });
    prepareGraphicsTask(emulator, version, code);
    // Interrupt-on-break makes an accidental HLE completion observable in MI.
    emulator.hardware.spRegDevice.write32(0xa4040000 + SP_STATUS_REG, SP_SET_INTR_BREAK);
    expect(() => startRSPTask(emulator)).toThrow(`Unsupported graphics microcode: ${family}`);
    expect(seen[0]).toMatchObject({ family, detection });
    expect(emulator.hardware.sp_reg.getU32(SP_STATUS_REG) & (SP_STATUS_TASKDONE | SP_STATUS_BROKE)).toBe(0);
    expect(emulator.hardware.mi_reg.getU32(MI_INTR_REG) & (MI_INTR_DP | MI_INTR_SP)).toBe(0);
    expect(emulator.hardware.spRegDevice.hleTask).toBeNull();
  });

  test.each(unsupportedMicrocodes)('leaves $family available to explicit LLE without claiming HLE execution', async ({ family, version, code, detection }) => {
    const previousMode = graphicsOptions.emulationMode;
    try {
      graphicsOptions.emulationMode = 'LLE';
      const seen = [];
      const loaded = [];
      const emulator = await createEmulator({
        executeGraphics: true, onGraphicsTask: info => seen.push(info), onMicrocodeLoad: info => loaded.push(info),
      });
      prepareGraphicsTask(emulator, version, code);
      emulator.hardware.sp_mem.set32(0xfc0 + TaskOffsets.dataPtr, 0x1000000);
      expect(() => startRSPTask(emulator)).not.toThrow();
      expect(seen[0]).toMatchObject({ family, detection });
      expect(loaded).toEqual([]);
      expect(emulator.hardware.rsp.halted).toBe(false);
      expect(emulator.hardware.sp_reg.getU32(SP_STATUS_REG) & SP_STATUS_TASKDONE).toBe(0);
      expect(emulator.hardware.mi_reg.getU32(MI_INTR_REG) & MI_INTR_DP).toBe(0);
    } finally {
      graphicsOptions.emulationMode = previousMode;
    }
  });

  test('executes drawing commands and in-list microcode switches through SP dispatch', async () => {
    const seen = [];
    const loaded = [];
    const emulator = await createEmulator({
      executeGraphics: true,
      onGraphicsTask: info => seen.push(info),
      onMicrocodeLoad: info => {
        loaded.push({ ...info });
        // Observers cannot change which handler executes the following commands.
        info.id = MicrocodeId.GBI0;
        info.version = 'changed by observer';
        return MicrocodeId.GBI0;
      },
    });
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
      [0xe9000000, 0], // FullSync requests the DP interrupt.
      [0xdf000000, 0],
    ]);
    startRSPTask(emulator);

    const { state, renderer } = hardware.graphics;
    expect(state.projectedVertices.slice(0, 3).every(vertex => vertex.set)).toBe(true);
    expect(state.tiles[0]).toMatchObject({ format: ImageFormat.G_IM_FMT_CI, size: ImageSize.G_IM_SIZ_4b });
    expect(state.primColor).toBe(0x12345678);
    expect(state.pc).toBe(0);
    expect(renderer.nativeTransform).toMatchObject({ viWidth: 640, viHeight: 480 });
    expect(seen).toHaveLength(1); // The observer still reports only task starts.
    expect(seen[0].family).toBe('GBI2');
    expect(loaded.map(info => info.family)).toEqual(['GBI2', 'GBI1', 'GBI2']);
    expect(hardware.rsp.halted).toBe(true);
    expect(hardware.sp_reg.getU32(SP_STATUS_REG) & SP_STATUS_TASKDONE).toBe(SP_STATUS_TASKDONE);
    expect(hardware.mi_reg.getU32(MI_INTR_REG) & MI_INTR_DP).toBe(MI_INTR_DP);
  });

  test('preserves graphics observers across reset and keeps their snapshots and instances independent', async () => {
    const loaded = [];
    const textures = [];
    const emulator = await createEmulator({
      executeGraphics: true,
      onMicrocodeLoad: info => loaded.push(info),
      onTextureUse: info => textures.push(info),
    });
    const commands = [
      [0xf5000000 | (ImageFormat.G_IM_FMT_CI << 21) | (1 << 9), 0],
      [0xe4020020, 0], [0xe1000000, 0], [0xf1000000, 0x04000400],
      [0xdf000000, 0],
    ];
    for (let run = 0; run < 2; run++) {
      emulator.hardware.reset();
      prepareGraphicsTask(emulator);
      setGraphicsCommands(emulator, commands);
      startRSPTask(emulator);
    }
    expect(loaded).toHaveLength(2);
    expect(textures).toHaveLength(2);
    loaded[0].family = 'changed by observer';
    textures[0].format = ImageFormat.G_IM_FMT_IA;
    expect(loaded[1].family).toBe('GBI2');
    expect(textures[1]).toEqual({ format: ImageFormat.G_IM_FMT_CI, size: ImageSize.G_IM_SIZ_4b });

    const fresh = await createEmulator({ executeGraphics: true });
    prepareGraphicsTask(fresh);
    setGraphicsCommands(fresh, commands);
    startRSPTask(fresh);
    expect(loaded).toHaveLength(2);
    expect(textures).toHaveLength(2);
  });

  test('starts each task afresh while preserving RDP state until hardware reset', async () => {
    const emulator = await createEmulator({ executeGraphics: true });
    prepareGraphicsTask(emulator);
    setGraphicsCommands(emulator, [[0xfa000000, 0x12345678], [0xdf000000, 0]]);
    startRSPTask(emulator);
    setGraphicsCommands(emulator, [[0xfb000000, 0xabcdef01], [0xdf000000, 0]]);
    startRSPTask(emulator);
    expect(emulator.hardware.graphics.state).toMatchObject({ primColor: 0x12345678, envColor: 0xabcdef01, pc: 0 });

    emulator.hardware.reset();
    prepareGraphicsTask(emulator);
    setGraphicsCommands(emulator, [[0xdf000000, 0]]);
    startRSPTask(emulator);
    expect(emulator.hardware.graphics.state).toMatchObject({ primColor: 0, envColor: 0, pc: 0 });

    setGraphicsCommands(emulator, [[0xfa000000, 0x87654321], [0xdf000000, 0]]);
    startRSPTask(emulator);
    const fresh = await createEmulator({ executeGraphics: true });
    expect(fresh.hardware.graphics.state.primColor).toBe(0);
    expect(emulator.hardware.graphics.state.primColor).toBe(0x87654321);
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
        const loaded = [];
        const textures = [];
        const emulator = await createEmulator({
          ...options, onMicrocodeLoad: info => loaded.push(info), onTextureUse: info => textures.push(info),
        });
        prepareGraphicsTask(emulator);
        // This would throw if the display-list runner tried to read it.
        emulator.hardware.sp_mem.set32(0xfc0 + TaskOffsets.dataPtr, 0x1000000);
        expect(() => startRSPTask(emulator, taskType)).not.toThrow();
        expect(loaded).toEqual([]);
        expect(textures).toEqual([]);
        expect(emulator.hardware.dpcDevice.readU32(0xa4100010)).toBe(mode === 'HLE' && taskType === 1 ? 1 : 0);
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
      const emulator = await createEmulator({ executeGraphics: true, onHalt: (message, details) => halted.push({ message, details }) });
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
      expect(emulator.fatalError()).toBe(halted[0].message);
      expect(halted[0].details.error).toBeInstanceOf(Error);
      expect(halted[0].details.error.message).toContain('Unknown display list op');
      expect(hardware.graphics.state.primColor).toBe(0);
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

describe('audio task callback', () => {
  test('reports unknown audio starts in LLE and Disabled modes without handling the task', async () => {
    const previous = audioOptions.emulationMode;
    try {
      for (const mode of ['LLE', 'Disabled']) {
        audioOptions.emulationMode = mode;
        const seen = [];
        const emulator = await createEmulator({ onAudioTask: info => { seen.push(info); return true; } });
        prepareGraphicsTask(emulator);
        startRSPTask(emulator, 1);
        expect(seen).toEqual([]);
        emulator.hardware.rsp.halt(0);
        startRSPTask(emulator, 2);
        expect(seen).toEqual([{ family: 'Unknown', detection: 'unknown' }]);
        expect(emulator.hardware.rsp.halted).toBe(mode === 'Disabled');
        seen[0].family = 'changed by observer';
        startRSPTask(emulator, 2);
        expect(seen).toHaveLength(2);
        expect(seen[1]).toEqual({ family: 'Unknown', detection: 'unknown' });
        expect(seen[1]).not.toBe(seen[0]);
        emulator.hardware.reset();
        prepareGraphicsTask(emulator);
        startRSPTask(emulator, 2);
        expect(seen).toHaveLength(3);
        expect(seen[2]).toEqual({ family: 'Unknown', detection: 'unknown' });
      }
    } finally {
      audioOptions.emulationMode = previous;
    }
  });
});

describe('HLE display-list producer waits', () => {
  test('signals FullSync before a producer wait without repeating it on task completion', async () => {
    const emulator = await createEmulator({ executeGraphics: true });
    const { cpu0, hardware } = emulator;
    cpu0.pc = 0x80007000;
    cpu0.setControlU32(controlStatus, 0);
    cpu0.cop1ControlChanged();
    prepareGraphicsTask(emulator);
    setGraphicsCommands(emulator, [
      [0xe9000000, 0],
      [0xde010000, 0x3008],
      [0xdf000000, 0],
    ]);
    let dp = 0;
    hardware.miRegDevice.interruptDP = () => { dp++; };
    startRSPTask(emulator);
    expect(dp).toBe(1);
    expect(hardware.sp_reg.getU32(SP_STATUS_REG) & SP_STATUS_TASKDONE).toBe(0);
    runCycles(emulator, 2000);
    expect(dp).toBe(1);
    hardware.ram.set32(0x3008, 0);
    runCycles(emulator, 2000);
    expect(dp).toBe(1);
    expect(hardware.sp_reg.getU32(SP_STATUS_REG) & SP_STATUS_TASKDONE).toBe(SP_STATUS_TASKDONE);
  });

  async function waitingTask() {
    const tasks = [], loads = [];
    const emulator = await createEmulator({
      executeGraphics: true,
      onGraphicsTask: info => tasks.push(info),
      onMicrocodeLoad: info => loads.push(info),
    });
    const { cpu0, hardware } = emulator;
    cpu0.pc = 0x80007000;
    cpu0.setControlU32(controlStatus, 0);
    cpu0.cop1ControlChanged();
    prepareGraphicsTask(emulator);
    setGraphicsCommands(emulator, [
      [0xfa000000, 0x12345678],
      [0xde010000, 0x3008],
      [0xfa000000, 0xabcdef01],
      [0xe9000000, 0],
      [0xdf000000, 0],
    ]);
    hardware.spRegDevice.spUpdateStatus(SP_SET_INTR_BREAK);
    startRSPTask(emulator);
    return { emulator, tasks, loads };
  }

  test('allows the CPU to patch a live list and only then signals task completion', async () => {
    const { emulator, tasks, loads } = await waitingTask();
    const { cpu0, hardware } = emulator;
    const completeBits = SP_STATUS_TASKDONE | SP_STATUS_BROKE | SP_STATUS_HALT;
    let dp = 0, sp = 0;
    const interruptDP = hardware.miRegDevice.interruptDP.bind(hardware.miRegDevice);
    const interruptSP = hardware.miRegDevice.interruptSP.bind(hardware.miRegDevice);
    hardware.miRegDevice.interruptDP = () => { dp++; interruptDP(); };
    hardware.miRegDevice.interruptSP = () => { sp++; interruptSP(); };
    runCycles(emulator, 2000);
    expect(hardware.graphics.state.primColor).toBe(0x12345678);
    expect(hardware.sp_reg.getU32(SP_STATUS_REG) & completeBits).toBe(0);
    expect(hardware.mi_reg.getU32(MI_INTR_REG) & MI_INTR_DP).toBe(0);
    expect([dp, sp]).toEqual([0, 0]);

    // Real guest instructions publish more commands by clearing the wait marker.
    cpu0.pc = 0x80007000;
    hardware.ram.set32(0x7000, 0x3c088000); // lui t0, 0x8000
    hardware.ram.set32(0x7004, 0x35083008); // ori t0, t0, 0x3008
    hardware.ram.set32(0x7008, 0xad000000); // sw zero, 0(t0)
    runCycles(emulator, 2000);
    expect(hardware.graphics.state.primColor).toBe(0xabcdef01);
    expect(hardware.sp_reg.getU32(SP_STATUS_REG) & completeBits).toBe(completeBits);
    expect(hardware.mi_reg.getU32(MI_INTR_REG) & MI_INTR_DP).toBe(MI_INTR_DP);
    expect([dp, sp]).toEqual([1, 1]);
    expect(tasks).toHaveLength(1);
    expect(loads).toHaveLength(1);
    expect(hardware.spRegDevice.hleTask).toBeNull();
  });

  test('pauses a pending task on SP halt and resumes it without reloading', async () => {
    const { emulator, tasks, loads } = await waitingTask();
    const { hardware } = emulator;
    hardware.spRegDevice.spUpdateStatus(SP_SET_HALT);
    hardware.ram.set32(0x3008, 0);
    runCycles(emulator, 2000);
    expect(hardware.graphics.state.primColor).toBe(0x12345678);
    expect(hardware.sp_reg.getU32(SP_STATUS_REG) & SP_STATUS_TASKDONE).toBe(0);
    hardware.spRegDevice.spUpdateStatus(SP_CLR_HALT);
    runCycles(emulator, 2000);
    expect(hardware.graphics.state.primColor).toBe(0xabcdef01);
    expect(tasks).toHaveLength(1);
    expect(loads).toHaveLength(1);
  });

  test('reset discards a pending continuation and its event', async () => {
    const { emulator } = await waitingTask();
    emulator.hardware.reset();
    expect(emulator.hardware.spRegDevice.hleTask).toBeNull();
    expect(emulator.cpu0.hasEvent('HLE graphics wait')).toBe(false);
  });
});
