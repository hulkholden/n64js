import { MemoryRegion } from './MemoryRegion.js';

export class Hardware {
  constructor(rominfo) {
    this.rom = null;   // Will be memory, mapped at 0xb0000000
    this.pi_mem = newMemoryRegion(0x7c0 + 0x40);   // rom+ram
    this.ram = newMemoryRegion(8 * 1024 * 1024);
    this.sp_mem = newMemoryRegion(0x2000);
    this.sp_reg = newMemoryRegion(0x20);
    this.sp_ibist_mem = newMemoryRegion(0x8);
    this.dpc_mem = newMemoryRegion(0x20);
    this.dps_mem = newMemoryRegion(0x10);
    this.rdram_reg = newMemoryRegion(0x30);
    this.mi_reg = newMemoryRegion(0x10);
    this.vi_reg = newMemoryRegion(0x38);
    this.ai_reg = newMemoryRegion(0x18);
    this.pi_reg = newMemoryRegion(0x34);
    this.ri_reg = newMemoryRegion(0x20);
    this.si_reg = newMemoryRegion(0x1c);

    // TODO: Not sure this belongs here.
    this.rominfo = rominfo;
  }

  createROM(arrayBuffer) {
    this.rom = new MemoryRegion(arrayBuffer);
  }

  clear() {
    this.pi_mem.clear();
    this.ram.clear();
    this.sp_mem.clear();
    this.sp_reg.clear();
    this.sp_ibist_mem.clear();
    this.rdram_reg.clear();
    this.dpc_mem.clear();
    this.dps_mem.clear();
    this.mi_reg.clear();
    this.vi_reg.clear();
    this.ai_reg.clear();
    this.pi_reg.clear();
    this.ri_reg.clear();
    this.si_reg.clear();
  }
}

function newMemoryRegion(size) {
  return new MemoryRegion(new ArrayBuffer(size));
}
