import { MemoryRegion } from './MemoryRegion.js';

export class Hardware {
    constructor() {
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
    }

    createROM(arrayBuffer) {
        this.rom = new MemoryRegion(arrayBuffer);
    }
}

function newMemoryRegion(size) {
    return new MemoryRegion(new ArrayBuffer(size));
}
