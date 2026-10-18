import { describe, expect, test } from 'bun:test';
import { controlStatus } from './cpu/cpu0reg.js';
import { createHeadlessEmulator } from './headless/headless_env.js';

// Regional stream-advance helpers and their globals, observed in the three
// retail images. No ROM is required: the fixture contains only the wait and
// buffer-switch code, with a receive stub that records a would-block call.
const regions = [
  { name: 'USA', id: '0b15d45cf1c20c47', entry: 0x8005aa98, count: 0xcdf8, queue: 0xdf70, receive: 0x8007cd08 },
  { name: 'Europe', id: '85ec851131775a4b', entry: 0x8005aad8, count: 0xce38, queue: 0xdfb0, receive: 0x8007cde8 },
  { name: 'Japan', id: '819b9b3911ad33d5', entry: 0x8005ab08, count: 0xd198, queue: 0xe310, receive: 0x8007ce98 },
];

const jump = address => 0x08000000 | ((address >>> 2) & 0x03ffffff);
const jal = address => 0x0c000000 | ((address >>> 2) & 0x03ffffff);
const context = 0x80002000;
const done = 0x80003000;

async function fixture(region, { enabled = true, interpreter = false, length = 512, pending = !!length, remaining = 0, buffer = 0 } = {}) {
  const emulator = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { id: region.id, cic: '6102', tvType: 1, save: 'Eeprom4k' },
  }, { enableCompatibilityHacks: enabled });
  const { cpu0: cpu, hardware } = emulator;
  const ram = hardware.ram;
  cpu.setControlU32(controlStatus, 0);
  cpu.cop1ControlChanged();
  if (interpreter) {
    hardware.fragmentCache.lookupFragment = () => null;
  }

  const put = (address, words) => words.forEach((word, i) => ram.set32(address - 0x80000000 + i * 4, word));
  put(region.entry, [
    0x27bdffd8, 0xafb00018, 0x00808021, 0xafbf0020, 0xafb1001c,
    0x8e020014, 0x10400018, 0x3c118018, // Return if there is no next transfer.
    0x8e220000 | region.count, 0x10400008,
    0x3c048017, 0x24840000 | region.queue, 0x27a50010,
    jal(region.receive), 0x24060001,
    0x8e220000 | region.count, 0x2442ffff, 0xae220000 | region.count,
    0x8e030008, 0x8e040014, 0x8e050004, 0x24020001, 0xae00000c,
    0x00431023, 0xae020008, 0x14a00003, 0xae040010,
    jump(region.entry + 0x7c), 0xae000014,
    jal(region.entry - 0x120), 0x02002021,
    0x8fbf0020, 0x8fb1001c, 0x8fb00018, 0x03e00008, 0x27bd0028,
  ]);
  put(region.receive, [
    0x8c880008, // LW t0, validCount(a0)
    0x15000004, // BNE t0, zero, ready
    0x00000000,
    0x25290001, // Would block and let the competing loader reuse the buffer.
    0x03e00008,
    0x2402ffff,
    0x2508ffff, // ready: consume one completion message.
    0xac880008,
    0x254a0001, // Record successful receives in t2.
    0x03e00008,
    0x00001025,
  ]);
  put(region.entry - 0x120, [
    0x8e220000 | region.count, // Prefetch submits one more DMA.
    0x24420001, 0xae220000 | region.count,
    0x24020100, 0xac820014, // Set next transfer length to 256.
    0x256b0001, // Record calls in t3.
    0x03e00008, 0,
  ]);
  put(done, [jump(done), 0]);
  const queue = 0x80170000 + (region.queue << 16 >> 16);
  const count = 0x80180000 + (region.count << 16 >> 16);
  ram.set32(count - 0x80000000, pending ? 1 : 0);
  ram.set32(context - 0x80000000 + 4, remaining);
  ram.set32(context - 0x80000000 + 8, buffer);
  ram.set32(context - 0x80000000 + 0x14, length);
  cpu.pc = region.entry;
  cpu.setRegS32Extend(4, context);
  cpu.setRegS32Extend(29, 0x80010000);
  cpu.setRegS32Extend(31, done);
  cpu.setRegS32Extend(9, 0);
  cpu.setRegS32Extend(10, 0);
  cpu.setRegS32Extend(11, 0);
  return { ...emulator, queue, count };
}

describe('XG2 shared asset-buffer wait', () => {
  for (const region of regions) {
    for (const interpreter of [false, true]) {
      test(`${region.name}: waits for DMA before receiving/switching buffers (${interpreter ? 'interpreter' : 'dynarec'})`, async () => {
        const { cpu0: cpu, hardware, queue, count, fatalError } = await fixture(region, { interpreter });
        let completed = false;
        cpu.addEvent('Asset DMA completion', 20_000, () => {
          hardware.ram.set32(queue - 0x80000000 + 8, 1);
          completed = true;
        });
        cpu.run(10_000);
        expect(completed).toBe(false);
        expect(cpu.getRegU32Lo(9)).toBe(0); // Never called a blocking receive.
        expect(cpu.getRegU32Lo(10)).toBe(0);
        expect(hardware.ram.getU32(context - 0x80000000 + 8)).toBe(0);
        expect(hardware.ram.getU32(count - 0x80000000)).toBe(1);
        if (!interpreter) {
          expect([...hardware.fragmentCache.fragments.values()].some(fragment => fragment.func)).toBe(true);
        }

        cpu.run(11_000);
        expect(completed).toBe(true);
        expect(cpu.getRegU32Lo(9)).toBe(0);
        expect(cpu.getRegU32Lo(10)).toBe(1);
        expect(hardware.ram.getU32(queue - 0x80000000 + 8)).toBe(0);
        expect(hardware.ram.getU32(count - 0x80000000)).toBe(0);
        expect(hardware.ram.getU32(context - 0x80000000 + 8)).toBe(1);
        expect(hardware.ram.getU32(context - 0x80000000 + 0x10)).toBe(512);
        expect(hardware.ram.getU32(context - 0x80000000 + 0x14)).toBe(0);
        expect(cpu.getRegU32Lo(29)).toBe(0x80010000);
        expect(fatalError()).toBeNull();
      });
    }

    test(`${region.name}: a ready DMA is consumed immediately`, async () => {
      const { cpu0: cpu, hardware, queue } = await fixture(region);
      hardware.ram.set32(queue - 0x80000000 + 8, 1);
      cpu.run(100);
      expect(cpu.getRegU32Lo(9)).toBe(0);
      expect(cpu.getRegU32Lo(10)).toBe(1);
    });

    test(`${region.name}: end of stream needs no completion message`, async () => {
      const { cpu0: cpu } = await fixture(region, { length: 0 });
      cpu.run(100);
      expect(cpu.getRegU32Lo(9)).toBe(0);
      expect(cpu.getRegU32Lo(10)).toBe(0);
      expect(cpu.getRegU32Lo(29)).toBe(0x80010000);
      expect([done, done + 4]).toContain(cpu.pc);
    });

    test(`${region.name}: an already-consumed completion still switches the buffered data`, async () => {
      const { cpu0: cpu, hardware, count } = await fixture(region, { pending: false, buffer: 1 });
      cpu.run(100);
      expect(cpu.getRegU32Lo(9)).toBe(0);
      expect(cpu.getRegU32Lo(10)).toBe(0);
      expect(hardware.ram.getU32(count - 0x80000000)).toBe(0);
      expect(hardware.ram.getU32(context - 0x80000000 + 8)).toBe(0);
      expect(hardware.ram.getU32(context - 0x80000000 + 0x10)).toBe(512);
      expect([done, done + 4]).toContain(cpu.pc);
    });

    test(`${region.name}: more source data still starts the next prefetch`, async () => {
      const { cpu0: cpu, hardware, queue, count } = await fixture(region, { remaining: 1024 });
      hardware.ram.set32(queue - 0x80000000 + 8, 1);
      cpu.run(100);
      expect(cpu.getRegU32Lo(9)).toBe(0);
      expect(cpu.getRegU32Lo(10)).toBe(1);
      expect(cpu.getRegU32Lo(11)).toBe(1);
      expect(hardware.ram.getU32(count - 0x80000000)).toBe(1);
      expect(hardware.ram.getU32(context - 0x80000000 + 8)).toBe(1);
      expect(hardware.ram.getU32(context - 0x80000000 + 0x10)).toBe(512);
      expect(hardware.ram.getU32(context - 0x80000000 + 0x14)).toBe(256);
      expect([done, done + 4]).toContain(cpu.pc);
    });

    test(`${region.name}: disabling compatibility reproduces the premature blocking receive`, async () => {
      const { cpu0: cpu } = await fixture(region, { enabled: false });
      cpu.run(100);
      expect(cpu.getRegU32Lo(9)).toBe(1);
      expect(cpu.getRegU32Lo(10)).toBe(0);
    });
  }
});
