import { MemoryRegion } from './MemoryRegion.js';

export class Hardware {
    constructor() {
        this.rom = null;   // Will be memory, mapped at 0xb0000000
        this.pi_mem = new MemoryRegion(new ArrayBuffer(0x7c0 + 0x40));   // rom+ram
        this.ram = new MemoryRegion(new ArrayBuffer(8 * 1024 * 1024));
        this.sp_mem = new MemoryRegion(new ArrayBuffer(0x2000));
        this.sp_reg = new MemoryRegion(new ArrayBuffer(0x20));
        this.sp_ibist_mem = new MemoryRegion(new ArrayBuffer(0x8));
        this.dpc_mem = new MemoryRegion(new ArrayBuffer(0x20));
        this.dps_mem = new MemoryRegion(new ArrayBuffer(0x10));
        this.rdram_reg = new MemoryRegion(new ArrayBuffer(0x30));
        this.mi_reg = new MemoryRegion(new ArrayBuffer(0x10));
        this.vi_reg = new MemoryRegion(new ArrayBuffer(0x38));
        this.ai_reg = new MemoryRegion(new ArrayBuffer(0x18));
        this.pi_reg = new MemoryRegion(new ArrayBuffer(0x34));
        this.ri_reg = new MemoryRegion(new ArrayBuffer(0x20));
        this.si_reg = new MemoryRegion(new ArrayBuffer(0x1c));
    }

    createROM(arrayBuffer) {
        this.rom = new MemoryRegion(arrayBuffer);
    }
}