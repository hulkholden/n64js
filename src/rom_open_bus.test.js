import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from './headless_env.js';
import { OS_TV_NTSC } from './system_constants.js';
import { Fragment } from './fragments.js';
import { FragmentContext, generateCodeForOp } from './recompiler.js';

function createEmulator(save = 'Eeprom4k') {
  return createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: OS_TV_NTSC, save },
  });
}

describe('cartridge domain 2 address 2 open bus', () => {
  test('selects big-endian bytes and halfwords from the aligned open-bus word', async () => {
    const { hardware } = await createEmulator();
    const device = hardware.romD2A2Device;
    for (const [address, word, bytes] of [
      [0xa8088000, 0x80008000, [0x80, 0x00, 0x80, 0x00]],
      [0xaaaab1f4, 0xb1f4b1f4, [0xb1, 0xf4, 0xb1, 0xf4]],
      [0xaffffffc, 0xfffcfffc, [0xff, 0xfc, 0xff, 0xfc]],
    ]) {
      expect(device.readU32(address)).toBe(word);
      for (let i = 0; i < 4; i++) {
        expect(device.readU8(address + i)).toBe(bytes[i]);
      }
      expect(device.readU16(address)).toBe(word >>> 16);
      expect(device.readU16(address + 2)).toBe(word & 0xffff);
    }
  });

  test('does not alias save memory or change unsupported accesses below open bus', async () => {
    for (const save of ['Eeprom4k', 'SRAM', 'SRAM96k', 'FlashRam']) {
      const { hardware } = await createEmulator(save);
      const device = hardware.romD2A2Device;
      hardware.saveMem.u8.fill(0x3c);
      device.flashStatus.set64(0, 0x1111800100c2001dn);
      expect(device.readU8(0xaaaab1f6)).toBe(0xb1);
      expect(device.readU16(0xaaaab1f6)).toBe(0xb1f4);
      for (const address of [0xa8000000, 0xa8087ffe]) {
        expect(() => device.readU8(address)).toThrow('Reading 8 bits from rom d2a2');
        expect(() => device.readU16(address)).toThrow('Reading 16 bits from rom d2a2');
      }
      expect(hardware.saveMem.u8.every(value => value === 0x3c)).toBe(true);
      expect(hardware.saveDirty).toBe(false);
      expect(device.flashStatus.getU64(0)).toBe(0x1111800100c2001dn);
    }
  });

  for (const compiled of [false, true]) {
    test(`F1 cleanup LBU continues with the open-bus flag (${compiled ? 'compiled' : 'interpreted'})`, async () => {
      const { cpu0, fatalError } = await createEmulator();
      // F1 initializes this pointer to 0xAAAAAAAA, then checks flags at +0x74c
      // before allocating the object. The open-bus byte must have bit 4 set so
      // the cleanup skips its store through the uninitialized pointer.
      cpu0.pc = 0x80163910;
      cpu0.nextPC = cpu0.pc + 4;
      cpu0.setRegS32Extend(3, 0xaaaaaaaa);
      const instruction = 0x9062074c; // LBU v0, 0x74c(v1)
      if (compiled) {
        const fragment = new Fragment(cpu0.pc);
        fragment.opsCompiled = 1;
        const context = new FragmentContext();
        context.set(fragment, cpu0.pc, instruction, cpu0.nextPC, cpu0.nextPC);
        generateCodeForOp(context);
        new Function('c', fragment.bodyCode)(cpu0);
      } else {
        n64js.executeOp(instruction);
      }
      expect(cpu0.getRegU64(2)).toBe(0xb1n);
      cpu0.execANDI(2, 2, 0x18);
      expect(cpu0.getRegU64(2)).toBe(0x10n);
      expect(cpu0.getRegU64(3)).toBe(0xffffffffaaaaaaaan);
      expect(fatalError()).toBeNull();
    });
  }
});
