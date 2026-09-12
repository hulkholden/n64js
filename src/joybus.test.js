import { beforeEach, describe, expect, test } from 'bun:test';
import { ControllerInputs } from './controllers.js';
import { Joybus } from './joybus.js';
import { MemoryRegion } from './memory_region.js';

let hardware;
let inputs;
let joybus;

beforeEach(() => {
  hardware = {
    pif_mem: new MemoryRegion(new ArrayBuffer(0x800)),
    mempacks: [{ data: new Uint8Array(0x8000) }],
    saveType: 'Eeprom4k',
    saveMem: new MemoryRegion(new ArrayBuffer(512)),
    saveDirty: false,
  };
  inputs = Array.from({ length: 4 }, () => new ControllerInputs());
  Object.assign(inputs[0], { buttons: 0x1234, stick_x: 0x56, stick_y: 0x78 });
  joybus = new Joybus(hardware, inputs);
});

function writeFrame(command, rx, { channel = 0, configure = true } = {}) {
  const source = new MemoryRegion(new ArrayBuffer(64));
  source.u8.fill(0xcc);
  source.u8.fill(0, 0, channel);
  source.u8.set([command.length, rx, ...command], channel);
  source.u8[channel + 2 + command.length + rx] = 0xfe;
  source.u8[63] = configure ? 1 : 0;
  joybus.dmaWrite(source, 0);
}

function readFrame() {
  const output = new MemoryRegion(new ArrayBuffer(64));
  joybus.dmaRead(output, 0);
  return output.u8;
}

describe('reused Joybus frames', () => {
  test('clears a no-response error after a controller becomes present', () => {
    joybus.channels[0].present = false;
    writeFrame([0x01], 4);
    expect(readFrame()[1]).toBe(0x84);

    joybus.channels[0].present = true;
    const output = readFrame();
    expect(output[1]).toBe(0x04);
    expect([...output.slice(3, 7)]).toEqual([0x12, 0x34, 0x56, 0x78]);
  });

  test('clears old receive flags supplied in a reused DMA buffer', () => {
    writeFrame([0x01], 4);
    const source = new MemoryRegion(readFrame().buffer);
    source.u8[1] |= 0xc0;
    joybus.dmaWrite(source, 0);
    expect(readFrame()[1]).toBe(0x04);
  });

  test('uses a larger RX length without reconfiguration', () => {
    writeFrame([0x00], 3);
    expect([...readFrame().slice(3, 6)]).toEqual([0x05, 0x00, 0x01]);

    writeFrame([0x01], 4, { configure: false });
    const output = readFrame();
    expect(output[1]).toBe(0x04);
    expect([...output.slice(3, 8)]).toEqual([0x12, 0x34, 0x56, 0x78, 0xfe]);
  });

  test('uses a smaller RX length and preserves later channel positions', () => {
    joybus.channels[1].present = true;
    inputs[1].buttons = 0xabcd;
    const source = new MemoryRegion(new ArrayBuffer(64));
    source.u8.set([1, 4, 1, 0, 0, 0, 0, 1, 4, 1, 0, 0, 0, 0, 0xfe]);
    source.u8[63] = 1;
    joybus.dmaWrite(source, 0);
    readFrame();

    source.u8[1] = 2;
    source.u8[5] = 0xfe;
    source.u8[6] = 0xcc;
    source.u8[63] = 0;
    joybus.dmaWrite(source, 0);
    const output = readFrame();
    expect([...output.slice(3, 7)]).toEqual([0x12, 0x34, 0xfe, 0xcc]);
    expect([...output.slice(10, 14)]).toEqual([0xab, 0xcd, 0, 0]);
  });

  test('uses larger and smaller TX lengths and moves the response accordingly', () => {
    writeFrame([0x00], 3, { channel: 4 });
    readFrame();

    const data = [1, 2, 3, 4, 5, 6, 7, 8];
    writeFrame([0x05, 1, ...data], 1, { channel: 4, configure: false });
    const written = readFrame();
    expect([...hardware.saveMem.u8.slice(8, 16)]).toEqual(data);
    expect([...written.slice(6, 18)]).toEqual([0x05, 1, ...data, 0, 0xfe]);

    writeFrame([0x04, 1], 8, { channel: 4, configure: false });
    expect([...readFrame().slice(6, 17)]).toEqual([0x04, 1, ...data, 0xfe]);
  });

  test('samples fresh input on repeated reads of an unchanged frame', () => {
    writeFrame([0x01], 4);
    expect([...readFrame().slice(3, 7)]).toEqual([0x12, 0x34, 0x56, 0x78]);

    Object.assign(inputs[0], { buttons: 0x8000, stick_x: -80, stick_y: 80 });
    const output = readFrame();
    expect(output[1]).toBe(0x04);
    expect([...output.slice(3, 7)]).toEqual([0x80, 0x00, 0xb0, 0x50]);
  });

  for (const flag of [0x80, 0x40]) {
    test(`preserves a frame with TX flag 0x${flag.toString(16)}`, () => {
      writeFrame([0x01], 4);
      const source = new MemoryRegion(readFrame().buffer);
      source.u8[0] |= flag;
      source.u8[1] |= 0xc0;
      inputs[0].buttons = 0x8000;
      joybus.dmaWrite(source, 0);
      expect(readFrame()).toEqual(source.u8);
    });
  }

  test('bounds an expanded response before the PIF control byte', () => {
    hardware.saveMem.u8.set([1, 2, 3, 4, 5, 6, 7, 8]);
    const source = new MemoryRegion(new ArrayBuffer(64));
    source.u8.fill(0xff, 0, 50);
    source.u8.set([0, 0, 0, 0, 2, 1, 0x04, 0, 0xcc, 0xfe], 50);
    source.u8[63] = 1;
    joybus.dmaWrite(source, 0);

    source.u8[55] = 8;
    source.u8[63] = 0;
    joybus.dmaWrite(source, 0);
    const output = readFrame();
    expect([...output.slice(58, 63)]).toEqual([1, 2, 3, 4, 5]);
    expect(output[63]).toBe(0);
  });
});

describe('EEPROM addressing', () => {
  const data = [1, 2, 3, 4, 5, 6, 7, 8];

  for (const [alias, block] of [[64, 0], [128, 0], [192, 0], [255, 63]]) {
    test(`4K EEPROM reads block ${alias} as block ${block}`, () => {
      hardware.saveMem.u8.set(data, block * 8);
      writeFrame([0x04, alias], 8, { channel: 4 });

      const output = readFrame();
      expect(output[5]).toBe(8);
      expect([...output.slice(8, 16)]).toEqual(data);
      expect(hardware.saveDirty).toBe(false);
    });

    test(`4K EEPROM writes block ${alias} to block ${block}`, () => {
      hardware.saveMem.u8.fill(0xa5);
      const expected = hardware.saveMem.u8.slice();
      expected.set(data, block * 8);
      writeFrame([0x05, alias, ...data], 1, { channel: 4 });

      const output = readFrame();
      expect(output[5]).toBe(1);
      expect(output[16]).toBe(0);
      expect(hardware.saveMem.u8).toEqual(expected);
      expect(hardware.saveDirty).toBe(true);

      writeFrame([0x04, block], 8, { channel: 4 });
      expect([...readFrame().slice(8, 16)]).toEqual(data);
    });
  }

  test('16K EEPROM keeps all eight block-address bits for reads and writes', () => {
    hardware.saveType = 'Eeprom16k';
    hardware.saveMem = new MemoryRegion(new ArrayBuffer(2048));
    const blocks = [0, 63, 64, 128, 192, 255];

    for (const block of blocks) {
      const blockData = Array.from({ length: 8 }, (_, i) => (block + i) & 0xff);
      writeFrame([0x05, block, ...blockData], 1, { channel: 4 });
      const output = readFrame();
      expect(output[5]).toBe(1);
      expect(output[16]).toBe(0);
      expect([...hardware.saveMem.u8.slice(block * 8, block * 8 + 8)]).toEqual(blockData);
    }

    for (const block of blocks) {
      writeFrame([0x04, block], 8, { channel: 4 });
      const output = readFrame();
      expect(output[5]).toBe(8);
      expect([...output.slice(8, 16)]).toEqual(
        Array.from({ length: 8 }, (_, i) => (block + i) & 0xff));
    }
    expect(hardware.saveDirty).toBe(true);
  });

  test('a cartridge without EEPROM still returns no response', () => {
    hardware.saveType = '';
    hardware.saveMem = null;
    writeFrame([0x04, 64], 8, { channel: 4 });
    const read = readFrame();
    expect(read[5]).toBe(0x88);
    expect([...read.slice(8, 16)]).toEqual(Array(8).fill(0xcc));

    writeFrame([0x05, 64, ...data], 1, { channel: 4 });
    const written = readFrame();
    expect(written[5]).toBe(0x81);
    expect(written[16]).toBe(0xcc);
    expect(hardware.saveDirty).toBe(false);
  });
});

describe('cartridge RTC detection', () => {
  for (const [saveType, size, eepromID] of [
    ['Eeprom4k', 512, 0x80],
    ['Eeprom16k', 2048, 0xc0],
    ['SRAM', 32768, null],
    ['FlashRam', 131072, null],
    ['', 0, null],
  ]) {
    test(`${saveType || 'no save memory'} reports no RTC and preserves EEPROM detection`, () => {
      hardware.saveType = saveType;
      hardware.saveMem = size ? new MemoryRegion(new ArrayBuffer(size)) : null;
      writeFrame([0x06], 3, { channel: 4 });

      const rtc = readFrame();
      expect(rtc[5]).toBe(0x83);
      expect([...rtc.slice(7, 10)]).toEqual([0xcc, 0xcc, 0xcc]);
      expect(hardware.saveDirty).toBe(false);

      writeFrame([0x00], 3, { channel: 4, configure: false });
      const status = readFrame();
      expect(status[5]).toBe(eepromID === null ? 0x83 : 3);
      expect([...status.slice(7, 10)]).toEqual(
        eepromID === null ? [0xcc, 0xcc, 0xcc] : [0x00, eepromID, 0x00]);
    });
  }
});
