import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ControllerInputs } from '../controllers.js';
import { Joybus } from '../joybus.js';
import { MemoryRegion } from '../memory_region.js';
import { MI_INTR_REG, MI_INTR_SI } from './mi.js';
import { PIFMemDevice } from './pif.js';
import { SI_STATUS_REG, SI_STATUS_INTERRUPT } from './si.js';

const base = 0xbfc00000;
const ramBase = base + 0x7c0;
const controlStores = [['write32', 0x3c], ['write16', 0x3e], ['write8', 0x3f]];
let previousN64js;
let hardware;
let joybus;
let pif;

beforeEach(() => {
  previousN64js = globalThis.n64js;
  hardware = {
    pif_mem: new MemoryRegion(new ArrayBuffer(0x800)),
    mempacks: [{ data: new Uint8Array(0x8000) }],
    si_reg: new MemoryRegion(new ArrayBuffer(0x20)),
    mi_reg: new MemoryRegion(new ArrayBuffer(0x10)),
  };
  const inputs = Array.from({ length: 4 }, () => new ControllerInputs());
  Object.assign(inputs[0], { buttons: 0x1234, stick_x: -80, stick_y: 80 });
  joybus = new Joybus(hardware, inputs);
  pif = new PIFMemDevice(hardware, base, base + 0x800);
  globalThis.n64js = {
    joybus: () => joybus,
    cpu0: { updateCause3() {} },
    halt: message => { throw new Error(message); },
  };
});

afterEach(() => {
  if (previousN64js === undefined) delete globalThis.n64js;
  else globalThis.n64js = previousN64js;
});

function writeControllerFrame(offset = 0) {
  for (let i = 0; i < offset; i += 4) {
    pif.write32(ramBase + i, 0xffffffff);
  }
  pif.write32(ramBase + offset, 0x010401cc);
  pif.write32(ramBase + offset + 4, 0xccccccfe);
}

function readFrame() {
  const output = new MemoryRegion(new ArrayBuffer(64));
  joybus.dmaRead(output, 0);
  return output.u8;
}

describe('CPU configuration of Joybus frames', () => {
  for (const [method, offset] of controlStores) {
    for (const control of [0x01, 0x81]) {
      test(`${method} configures a frame with control 0x${control.toString(16)}`, () => {
        writeControllerFrame();
        pif[method](ramBase + offset, 0x12345600 | control);

        expect(joybus.controlByte).toBe(control & ~1);
        // Narrow PIF stores still write the full source word at these offsets.
        expect(hardware.pif_mem.getU32(0x7fc)).toBe(0x12345600 | (control & ~1));
        expect([...joybus.pifRam.u8.slice(3, 7)]).toEqual(Array(4).fill(0xcc));
        const output = readFrame();
        expect(output[1]).toBe(4);
        expect([...output.slice(3, 7)]).toEqual([0x12, 0x34, 0xb0, 0x50]);
      });
    }

    test(`${method} leaves channel positions alone when the configure bit is clear`, () => {
      writeControllerFrame();
      pif[method](ramBase + offset, 1);
      expect([...readFrame().slice(3, 7)]).toEqual([0x12, 0x34, 0xb0, 0x50]);

      writeControllerFrame(8);
      pif[method](ramBase + offset, 0);
      expect([...readFrame().slice(11, 15)]).toEqual(Array(4).fill(0xcc));
    });
  }

  test('a CPU configuration replaces the previous channel positions', () => {
    writeControllerFrame();
    pif.write32(ramBase + 0x3c, 1);
    expect([...readFrame().slice(3, 7)]).toEqual([0x12, 0x34, 0xb0, 0x50]);

    writeControllerFrame(8);
    pif.write32(ramBase + 0x3c, 1);
    const output = readFrame();
    expect(output[9]).toBe(4);
    expect([...output.slice(11, 15)]).toEqual([0x12, 0x34, 0xb0, 0x50]);
  });

  test('DMA configuration still clears only the configure bit', () => {
    const source = new MemoryRegion(new ArrayBuffer(64));
    source.u8.set([1, 4, 1, 0xcc, 0xcc, 0xcc, 0xcc, 0xfe]);
    source.u8[63] = 0x81;
    joybus.dmaWrite(source, 0);

    expect(joybus.controlByte).toBe(0x80);
    expect([...readFrame().slice(3, 7)]).toEqual([0x12, 0x34, 0xb0, 0x50]);
  });
});

describe('PIF store behavior', () => {
  test('subword writes retain their alignment and full-register shifts', () => {
    for (const [method, offset, expected] of [
      ['write8', 0, 0x78000000],
      ['write8', 1, 0x56780000],
      ['write8', 2, 0x34567800],
      ['write8', 3, 0x12345678],
      ['write16', 0, 0x56780000],
      ['write16', 2, 0x12345678],
    ]) {
      hardware.pif_mem.set32(0x7d0, 0xffffffff);
      pif[method](ramBase + 0x10 + offset, 0x12345678);
      expect(hardware.pif_mem.getU32(0x7d0)).toBe(expected);
    }
  });

  test('the existing word-write interrupt command still raises SI', () => {
    pif.write32(ramBase + 0x3c, 0x08);
    expect(joybus.controlByte).toBe(0);
    expect(hardware.si_reg.getBits32(SI_STATUS_REG, SI_STATUS_INTERRUPT)).toBe(SI_STATUS_INTERRUPT);
    expect(hardware.mi_reg.getBits32(MI_INTR_REG, MI_INTR_SI)).toBe(MI_INTR_SI);
  });
});
