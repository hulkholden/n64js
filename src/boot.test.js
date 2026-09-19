import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from './headless/headless_env.js';
import { simulateBoot } from './boot.js';
import * as regs from './cpu/cpu0reg.js';
import { OS_TV_NTSC, OS_TV_PAL, OS_TV_MPAL } from './system_constants.js';

const regions = [
  { name: 'NTSC', tvType: OS_TV_NTSC, version: 0, ra: 0xa4001550, clock: 48681812, rate: 60 },
  { name: 'PAL', tvType: OS_TV_PAL, version: 6, ra: 0xa4001554, clock: 49656530, rate: 50 },
  { name: 'PAL-M', tvType: OS_TV_MPAL, version: 4, ra: 0xa4001554, clock: 48628316, rate: 60 },
];

function makeROM() {
  const romBuffer = new ArrayBuffer(0x1000);
  // A valid PI header followed by synthetic, all-zero IPL3 data. HLE boot does
  // not require a valid CIC checksum; this also avoids depending on a BIOS dump.
  new DataView(romBuffer).setUint32(0, 0x80371240);
  return romBuffer;
}

describe('PIF boot handoff', () => {
  for (const region of regions) {
    for (const [cic, seed, cicVersion] of [
      ['6101', 0x3f, 1], ['6102', 0x3f, 0], ['6103', 0x78, 0],
      ['6105', 0x91, 0], ['6106', 0x85, 0],
    ]) {
      test(`${region.name} CIC ${cic} preserves region, version and both seed roles`, async () => {
        const { cpu0, hardware } = await createHeadlessEmulator({
          romBuffer: makeROM(),
          rominfo: { cic, tvType: region.tvType, save: 'Eeprom4k' },
        });
        expect(cpu0.getRegU64(regs.S3)).toBe(0n); // Cartridge.
        expect(cpu0.getRegU64(regs.S4)).toBe(BigInt(region.tvType));
        expect(cpu0.getRegU64(regs.S5)).toBe(0n); // Cold reset.
        expect(cpu0.getRegU64(regs.S6)).toBe(BigInt(seed));
        expect(cpu0.getRegU64(regs.S7)).toBe(BigInt(region.version | cicVersion));
        expect(cpu0.getRegU64(regs.SP)).toBe(0xffffffff_a4001ff0n);
        expect(cpu0.getRegU64(regs.RA)).toBe(0xffffffff_00000000n | BigInt(region.ra));
        expect(cpu0.pc).toBe(0xa4000040);
        // All supported CICs seed IPL2 with 0x3f. These are independently
        // captured PIF execution results for zero-filled IPL3, not CIC presets.
        expect(cpu0.getRegU32Lo(regs.A0)).toBe(0x2982);
        expect(cpu0.getRegU32Lo(regs.A1)).toBe(0xad8c201d);
        expect(cpu0.getRegU64(regs.A1)).toBe(0xffffffff_ad8c201dn);
        expect(hardware.viRegDevice.videoClock).toBe(region.clock);
        expect(hardware.viRegDevice.refreshRate).toBe(region.rate);
      });
    }
  }

  test('sets the hardware state and IPL2 prefix used by CIC-6105 decryption', async () => {
    const { hardware, cpu0 } = await createHeadlessEmulator({
      romBuffer: makeROM(),
      rominfo: { cic: '6105', tvType: OS_TV_PAL, save: 'Eeprom4k' },
    });
    const imem = hardware.sp_mem.subRegion(0x1000, 0x20);
    expect(Array.from({ length: 8 }, (_, i) => imem.getU32(i * 4))).toEqual([
      0x3c0dbfc0, 0x8da807fc, 0x25ad07c0, 0x31080080,
      0x5500fffc, 0x3c0dbfc0, 0x8da80024, 0x3c0bb000,
    ]);
    // IPL3 XORs its first encrypted word pair with the relocated IPL2 prefix.
    expect((imem.getU32(0) ^ 0x7c1c97c0) >>> 0).toBe(0x40112800);
    expect((imem.getU32(4) ^ 0x9b88f802) >>> 0).toBe(0x1620fffe);
    expect(hardware.sp_reg.getU32(0x10)).toBe(1);
    expect(hardware.vi_reg.getU32(0x0c)).toBe(0x3ff);
    expect([0x14, 0x18, 0x1c, 0x20].map(offset => hardware.pi_reg.getU32(offset))).toEqual([0x40, 0x12, 7, 3]);
    expect(hardware.pif_mem.u8.subarray(0x7c0).every(value => value === 0)).toBe(true);
    // Keep the read-only Config bits; 0x0006e463 is just the PIF's write value.
    expect(cpu0.getControlU32(regs.controlConfig)).toBe(0x7006e463);
  });

  test('recomputes checksum results for a changed IPL3 and does not reuse a previous boot', async () => {
    const rominfo = { cic: '6102', tvType: OS_TV_NTSC, save: 'Eeprom4k' };
    const { hardware, cpu0 } = await createHeadlessEmulator({ romBuffer: makeROM(), rominfo });
    const first = cpu0.getRegU64(regs.A1);
    hardware.rom.u8.fill(0xff, 0x40, 0x1000);
    hardware.reset();
    hardware.loadROM();
    simulateBoot(cpu0, hardware, rominfo);
    expect(cpu0.getRegU64(regs.A1)).not.toBe(first);
    // Verified against the original PIF instructions for all-ones IPL3.
    expect(cpu0.getRegU32Lo(regs.A0)).toBe(0x0f74);
    expect(cpu0.getRegU32Lo(regs.A1)).toBe(0xe8302797);
  });
});
