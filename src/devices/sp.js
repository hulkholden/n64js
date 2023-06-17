import { Device } from './device.js';
import * as mi from './mi.js';
import * as logger from '../logger.js';
import { toString16, toString32 } from '../format.js';

export const SP_MEM_ADDR_REG = 0x00;
export const SP_DRAM_ADDR_REG = 0x04;
export const SP_RD_LEN_REG = 0x08;
export const SP_WR_LEN_REG = 0x0C;
export const SP_STATUS_REG = 0x10;
export const SP_DMA_FULL_REG = 0x14;
export const SP_DMA_BUSY_REG = 0x18;
export const SP_SEMAPHORE_REG = 0x1C;

export const SP_CLR_HALT = 0x0000001;
export const SP_SET_HALT = 0x0000002;
export const SP_CLR_BROKE = 0x0000004;
export const SP_CLR_INTR = 0x0000008;
export const SP_SET_INTR = 0x0000010;
export const SP_CLR_SSTEP = 0x0000020;
export const SP_SET_SSTEP = 0x0000040;
export const SP_CLR_INTR_BREAK = 0x0000080;
export const SP_SET_INTR_BREAK = 0x0000100;
export const SP_CLR_SIG0 = 0x0000200;
export const SP_SET_SIG0 = 0x0000400;
export const SP_CLR_SIG1 = 0x0000800;
export const SP_SET_SIG1 = 0x0001000;
export const SP_CLR_SIG2 = 0x0002000;
export const SP_SET_SIG2 = 0x0004000;
export const SP_CLR_SIG3 = 0x0008000;
export const SP_SET_SIG3 = 0x0010000;
export const SP_CLR_SIG4 = 0x0020000;
export const SP_SET_SIG4 = 0x0040000;
export const SP_CLR_SIG5 = 0x0080000;
export const SP_SET_SIG5 = 0x0100000;
export const SP_CLR_SIG6 = 0x0200000;
export const SP_SET_SIG6 = 0x0400000;
export const SP_CLR_SIG7 = 0x0800000;
export const SP_SET_SIG7 = 0x1000000;

export const SP_STATUS_HALT = 0x0001;
export const SP_STATUS_BROKE = 0x0002;
export const SP_STATUS_DMA_BUSY = 0x0004;
export const SP_STATUS_DMA_FULL = 0x0008;
export const SP_STATUS_IO_FULL = 0x0010;
export const SP_STATUS_SSTEP = 0x0020;
export const SP_STATUS_INTR_BREAK = 0x0040;
export const SP_STATUS_SIG0 = 0x0080;
export const SP_STATUS_SIG1 = 0x0100;
export const SP_STATUS_SIG2 = 0x0200;
export const SP_STATUS_SIG3 = 0x0400;
export const SP_STATUS_SIG4 = 0x0800;
export const SP_STATUS_SIG5 = 0x1000;
export const SP_STATUS_SIG6 = 0x2000;
export const SP_STATUS_SIG7 = 0x4000;

export const SP_STATUS_YIELD = SP_STATUS_SIG0;
export const SP_STATUS_YIELDED = SP_STATUS_SIG1;
export const SP_STATUS_TASKDONE = SP_STATUS_SIG2;

// TODO: dedupe.
function memoryCopy(dst, dstoff, src, srcoff, len) {
    var i;
    for (i = 0; i < len; ++i) {
        dst.u8[dstoff + i] = src.u8[srcoff + i];
    }
}

export class SPMemDevice extends Device {
    constructor(hardware, rangeStart, rangeEnd) {
        super("SPMem", hardware, hardware.sp_mem, rangeStart, rangeEnd);
    }
}

export class SPIBISTDevice extends Device {
    constructor(hardware, rangeStart, rangeEnd) {
        super("SPIBIST", hardware, hardware.sp_ibist_mem, rangeStart, rangeEnd);
    }
}

export class SPRegDevice extends Device {
    constructor(hardware, rangeStart, rangeEnd) {
        super("SPReg", hardware, hardware.sp_reg, rangeStart, rangeEnd);
    }

    write32(address, value) {
        var ea = this.calcEA(address);
        if (ea + 4 > this.u8.length) {
            throw 'Write is out of range';
        }

        switch (ea) {
            case SP_MEM_ADDR_REG:
            case SP_DRAM_ADDR_REG:
            case SP_SEMAPHORE_REG:
                this.mem.write32(ea, value);
                break;
            case SP_RD_LEN_REG:
                this.mem.write32(ea, value);
                this.spCopyFromRDRAM();
                break;

            case SP_WR_LEN_REG:
                this.mem.write32(ea, value);
                this.spCopyToRDRAM();
                break;

            case SP_STATUS_REG:
                this.spUpdateStatus(value);
                break;

            case SP_DMA_FULL_REG:
            case SP_DMA_BUSY_REG:
                // Prevent writing to read-only mem
                break;

            default:
                logger.log('Unhandled write to SPReg: ' + toString32(value) + ' -> [' + toString32(address) + ']');
                this.mem.write32(ea, value);
        }
    }

    halt() {
      const status = this.mem.setBits32(SP_STATUS_REG, SP_STATUS_TASKDONE | SP_STATUS_BROKE | SP_STATUS_HALT);
      if (status & SP_STATUS_INTR_BREAK) {
        this.hardware.miRegDevice.interruptSP();
      }
    }
  
    spUpdateStatus(flags) {
        if (!this.quiet) {
            if (flags & SP_CLR_HALT) { logger.log('SP: Clearing Halt'); }
            if (flags & SP_SET_HALT) { logger.log('SP: Setting Halt'); }
            if (flags & SP_CLR_BROKE) { logger.log('SP: Clearing Broke'); }
            // No SP_SET_BROKE
            if (flags & SP_CLR_INTR) { logger.log('SP: Clearing Interrupt'); }
            if (flags & SP_SET_INTR) { logger.log('SP: Setting Interrupt'); }
            if (flags & SP_CLR_SSTEP) { logger.log('SP: Clearing Single Step'); }
            if (flags & SP_SET_SSTEP) { logger.log('SP: Setting Single Step'); }
            if (flags & SP_CLR_INTR_BREAK) { logger.log('SP: Clearing Interrupt on break'); }
            if (flags & SP_SET_INTR_BREAK) { logger.log('SP: Setting Interrupt on break'); }
            if (flags & SP_CLR_SIG0) { logger.log('SP: Clearing Sig0 (Yield)'); }
            if (flags & SP_SET_SIG0) { logger.log('SP: Setting Sig0 (Yield)'); }
            if (flags & SP_CLR_SIG1) { logger.log('SP: Clearing Sig1 (Yielded)'); }
            if (flags & SP_SET_SIG1) { logger.log('SP: Setting Sig1 (Yielded)'); }
            if (flags & SP_CLR_SIG2) { logger.log('SP: Clearing Sig2 (TaskDone)'); }
            if (flags & SP_SET_SIG2) { logger.log('SP: Setting Sig2 (TaskDone)'); }
            if (flags & SP_CLR_SIG3) { logger.log('SP: Clearing Sig3'); }
            if (flags & SP_SET_SIG3) { logger.log('SP: Setting Sig3'); }
            if (flags & SP_CLR_SIG4) { logger.log('SP: Clearing Sig4'); }
            if (flags & SP_SET_SIG4) { logger.log('SP: Setting Sig4'); }
            if (flags & SP_CLR_SIG5) { logger.log('SP: Clearing Sig5'); }
            if (flags & SP_SET_SIG5) { logger.log('SP: Setting Sig5'); }
            if (flags & SP_CLR_SIG6) { logger.log('SP: Clearing Sig6'); }
            if (flags & SP_SET_SIG6) { logger.log('SP: Setting Sig6'); }
            if (flags & SP_CLR_SIG7) { logger.log('SP: Clearing Sig7'); }
            if (flags & SP_SET_SIG7) { logger.log('SP: Setting Sig7'); }
        }

        var clr_bits = 0;
        var set_bits = 0;

        var start_rsp = false;
        var stop_rsp = false;

        if (flags & SP_CLR_HALT) { clr_bits |= SP_STATUS_HALT; start_rsp = true; }
        if (flags & SP_SET_HALT) { set_bits |= SP_STATUS_HALT; stop_rsp = true; }

        if (flags & SP_SET_INTR) { this.hardware.mi_reg.setBits32(mi.MI_INTR_REG, mi.MI_INTR_SP); n64js.cpu0.updateCause3(); }   // Shouldn't ever set this?
        else if (flags & SP_CLR_INTR) { this.hardware.mi_reg.clearBits32(mi.MI_INTR_REG, mi.MI_INTR_SP); n64js.cpu0.updateCause3(); }

        clr_bits |= (flags & SP_CLR_BROKE) >> 1;
        clr_bits |= (flags & SP_CLR_SSTEP);
        clr_bits |= (flags & SP_CLR_INTR_BREAK) >> 1;
        clr_bits |= (flags & SP_CLR_SIG0) >> 2;
        clr_bits |= (flags & SP_CLR_SIG1) >> 3;
        clr_bits |= (flags & SP_CLR_SIG2) >> 4;
        clr_bits |= (flags & SP_CLR_SIG3) >> 5;
        clr_bits |= (flags & SP_CLR_SIG4) >> 6;
        clr_bits |= (flags & SP_CLR_SIG5) >> 7;
        clr_bits |= (flags & SP_CLR_SIG6) >> 8;
        clr_bits |= (flags & SP_CLR_SIG7) >> 9;

        set_bits |= (flags & SP_SET_SSTEP) >> 1;
        set_bits |= (flags & SP_SET_INTR_BREAK) >> 2;
        set_bits |= (flags & SP_SET_SIG0) >> 3;
        set_bits |= (flags & SP_SET_SIG1) >> 4;
        set_bits |= (flags & SP_SET_SIG2) >> 5;
        set_bits |= (flags & SP_SET_SIG3) >> 6;
        set_bits |= (flags & SP_SET_SIG4) >> 7;
        set_bits |= (flags & SP_SET_SIG5) >> 8;
        set_bits |= (flags & SP_SET_SIG6) >> 9;
        set_bits |= (flags & SP_SET_SIG7) >> 10;

        var status_bits = this.mem.readU32(SP_STATUS_REG);
        status_bits &= ~clr_bits;
        status_bits |= set_bits;
        this.mem.write32(SP_STATUS_REG, status_bits);

        if (start_rsp) {
            n64js.rspProcessTask();
        } else if (stop_rsp) {
            // As we handle all RSP via HLE, nothing to do here.
        }
    }

    spCopyFromRDRAM() {
        var sp_mem_address = this.mem.readU32(SP_MEM_ADDR_REG);
        var rd_ram_address = this.mem.readU32(SP_DRAM_ADDR_REG);
        var rdlen_reg = this.mem.readU32(SP_RD_LEN_REG);
        var splen = (rdlen_reg & 0xfff) + 1;

        if (!this.quiet) {
            logger.log('SP: copying from ram ' + toString32(rd_ram_address) + ' to sp ' + toString16(sp_mem_address));
        }

        memoryCopy(this.hardware.sp_mem, sp_mem_address & 0xfff, this.hardware.ram, rd_ram_address & 0xffffff, splen);

        this.mem.setBits32(SP_DMA_BUSY_REG, 0);
        this.mem.clearBits32(SP_STATUS_REG, SP_STATUS_DMA_BUSY);
    }

    spCopyToRDRAM() {
        var sp_mem_address = this.mem.readU32(SP_MEM_ADDR_REG);
        var rd_ram_address = this.mem.readU32(SP_DRAM_ADDR_REG);
        var wrlen_reg = this.mem.readU32(SP_WR_LEN_REG);
        var splen = (wrlen_reg & 0xfff) + 1;

        if (!this.quiet) {
            logger.log('SP: copying from sp ' + toString16(sp_mem_address) + ' to ram ' + toString32(rd_ram_address));
        }

        memoryCopy(this.hardware.ram, rd_ram_address & 0xffffff, this.hardware.sp_mem, sp_mem_address & 0xfff, splen);

        this.mem.setBits32(SP_DMA_BUSY_REG, 0);
        this.mem.clearBits32(SP_STATUS_REG, SP_STATUS_DMA_BUSY);
    }
}
