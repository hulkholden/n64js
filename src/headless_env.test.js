import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from './headless_env.js';
import { SI_DRAM_ADDR_REG, SI_PIF_ADDR_RD64B_REG, SI_PIF_ADDR_WR64B_REG, SI_STATUS_REG } from './devices/si.js';
import { OS_TV_NTSC } from './system_constants.js';

function createEmulator() {
  // Boot initialization only needs a buffer containing the bootstrap region.
  // These tests issue SI DMA requests directly, without running ROM code.
  return createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: OS_TV_NTSC, save: 'Eeprom4k' },
  });
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
