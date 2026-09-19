import { expect, test } from 'bun:test';
import { controlCause, controlEPC, controlStatus } from './cpu/cpu0reg.js';
import { createHeadlessEmulator } from './headless/headless_env.js';
import { MI_INTR_MASK_REG, MI_INTR_VI } from './devices/mi.js';

// Minimal scheduler/producer ordering, with no ROM required. A VI handler
// initializes a global that the producer immediately dereferences. The real
// games initialize it in their scheduler thread on the first VI message.
for (const [region, id, site, instruction, pointer, tvType, sync] of [
  ['USA', '9dae5305c1e0d8ea', 0x80002934, 0x0c00e852, 0x800c6b20, 1, 525],
  ['Europe', 'c767160aa6463329', 0x80002990, 0x0c00e8ce, 0x800c6880, 0, 625],
]) {
  test(`Xena ${region}: the startup delay lets VI initialize the producer's pointer`, async () => {
    for (const enableCompatibilityHacks of [false, true]) {
      const { cpu0: cpu, hardware } = await createHeadlessEmulator({
        romBuffer: new ArrayBuffer(0x1000),
        rominfo: { id, cic: '6102', tvType, save: 'Eeprom4k' },
      }, { enableCompatibilityHacks });
      const put = (address, words) => words.forEach((word, i) => hardware.ram.set32(address - 0x80000000 + i * 4, word));
      const target = (0x80000000 | ((instruction & 0x03ffffff) << 2)) >>> 0;
      put(site, [instruction, 0]); // JAL producer; NOP delay slot
      put(target, [0x3c02800c, 0x8c420000 | (pointer & 0xffff)]); // Load the global.
      put(0x80000180, [
        0x3c1a800c,                         // LUI k0, 0x800c
        0x341b1234,                         // ORI k1, zero, 0x1234
        0xaf5b0000 | (pointer & 0xffff),     // SW k1, global(k0)
        0x3c1aa440,                         // LUI k0, 0xa440
        0xaf400010,                         // SW zero, VI_CURRENT(k0): acknowledge
        0x42000018,                         // ERET
      ]);
      cpu.pc = site;
      cpu.setControlU32(controlStatus, 0x401); // Enable the RCP interrupt.
      cpu.cop1ControlChanged();
      hardware.mi_reg.set32(MI_INTR_MASK_REG, MI_INTR_VI);
      cpu.updateCause3();
      hardware.viRegDevice.write32(0xa4400018, sync);
      hardware.viRegDevice.write32(0xa440000c, 2);

      if (enableCompatibilityHacks) {
        cpu.run(2_000_001);
        expect(cpu.pc).toBe(0x80000180);
        expect(cpu.getControlU32(controlEPC)).toBe(site);
        expect(cpu.getControlU32(controlCause) >>> 31).toBe(1);
        expect(hardware.verticalBlankCount).toBe(1);
        expect(cpu.compatibilityHacks).toBeNull();
        cpu.run(6); // Initialize the pointer and return to the interrupted JAL.
        expect(cpu.pc).toBe(site);
      }
      const before = cpu.controlCountValue;
      cpu.run(4); // JAL, delay slot, LUI, LW. Replaying the JAL must not delay again.
      expect(cpu.controlCountValue - before).toBe(4);
      expect(cpu.getRegU32Lo(2)).toBe(enableCompatibilityHacks ? 0x1234 : 0);
      expect(hardware.ram.getU32(site - 0x80000000)).toBe(instruction);
    }
  });
}
