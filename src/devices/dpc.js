/*global n64js*/

import { Device } from './device.js';
import { toHex, toString32 } from '../format.js';
import * as logger from '../logger.js';
import * as mi from './mi.js';
import { RDPBuffer } from '../lle/rdp.js';
import { disassembleRange } from '../hle/disassemble_rdp.js';
import { graphicsOptions } from '../hle/graphics_options.js';

// DP Command
const DPC_START_REG = 0x00;
const DPC_END_REG = 0x04;
const DPC_CURRENT_REG = 0x08;
const DPC_STATUS_REG = 0x0C;
const DPC_CLOCK_REG = 0x10;
const DPC_BUFBUSY_REG = 0x14;
const DPC_PIPEBUSY_REG = 0x18;
const DPC_TMEM_REG = 0x1C;

const DPC_CLR_XBUS_DMEM_DMA = 0x0001;
const DPC_SET_XBUS_DMEM_DMA = 0x0002;
const DPC_CLR_FREEZE = 0x0004;
const DPC_SET_FREEZE = 0x0008;
const DPC_CLR_FLUSH = 0x0010;
const DPC_SET_FLUSH = 0x0020;
const DPC_CLR_TMEM_CTR = 0x0040;
const DPC_CLR_PIPE_CTR = 0x0080;
const DPC_CLR_CMD_CTR = 0x0100;
const DPC_CLR_CLOCK_CTR = 0x0200;

const DPC_STATUS_XBUS_DMEM_DMA = 0x001;
const DPC_STATUS_FREEZE = 0x002;
const DPC_STATUS_FLUSH = 0x004;
const DPC_STATUS_START_GCLK = 0x008;
const DPC_STATUS_TMEM_BUSY = 0x010;
const DPC_STATUS_PIPE_BUSY = 0x020;
const DPC_STATUS_CMD_BUSY = 0x040;
const DPC_STATUS_CBUF_READY = 0x080;
const DPC_STATUS_DMA_BUSY = 0x100;
const DPC_STATUS_END_VALID = 0x200;
const DPC_STATUS_START_VALID = 0x400;

const addressWritableBits = 0x00ff_fff8;
const statusWritableBits = 0x7ff;

export class DPCDevice extends Device {
  constructor(hardware, rangeStart, rangeEnd) {
    super("DPC", hardware, hardware.dpc_mem, rangeStart, rangeEnd);
  }

  // Raw register values.
  get startReg() { return this.mem.getU32(DPC_START_REG); }
  get endReg() { return this.mem.getU32(DPC_END_REG); }
  get currentReg() { return this.mem.getU32(DPC_CURRENT_REG); }
  get statusReg() { return this.mem.getU32(DPC_STATUS_REG); }

  set startReg(val) { this.mem.set32(DPC_START_REG, val & addressWritableBits); }
  set endReg(val) { this.mem.set32(DPC_END_REG, val & addressWritableBits); }
  set currentReg(val) { this.mem.set32(DPC_CURRENT_REG, val & addressWritableBits); }
  set statusReg(val) { this.mem.set32(DPC_STATUS_REG, val & statusWritableBits); }

  setStatusBits(bits, enabled) {
    this.mem.set32masked(DPC_STATUS_REG, enabled ? bits : 0, bits);
  }

  // Values derived from the registers.
  get xbusDmemDMA() { return (this.statusReg & DPC_STATUS_XBUS_DMEM_DMA) != 0; }
  get startValid() { return (this.statusReg & DPC_STATUS_START_VALID) != 0; }
  set startValid(val) { this.setStatusBits(DPC_STATUS_START_VALID, val); }

  write32(address, value) {
    this.writeReg32(this.calcWriteEA(address), value);
  }

  writeReg32(ea, value) {
    if (ea + 4 > this.u8.length) {
      throw 'Write is out of range';
    }
    switch (ea) {
      case DPC_START_REG:
        if (!this.quiet) { logger.log(`DPC start set to: ${toString32(value)}`); }

        if (this.startValid) {
          // Subsequent writes to startReg are ignored.
        } else {
          this.startReg = value;
          this.startValid = true;
        }
        break;
      case DPC_END_REG:
        if (!this.quiet) { logger.log(`DPC end set to: ${toString32(value)}`); }

        this.currentReg = this.startReg;
        this.endReg = value;
        if (this.startValid) {
          // No transfer in progress? Set end, start running
          // Transfer in progress? Set end pending
        } else {
          // Incremental transfer.
        }

        this.startValid = false;
        this.setStatusBits(DPC_STATUS_CBUF_READY | DPC_STATUS_PIPE_BUSY | DPC_STATUS_START_GCLK, true);
        this.processBuffer();
        break;
      case DPC_STATUS_REG:
        //if (!this.quiet) { logger.log(`DPC status set to: ${toString32(value)}` ); }
        this.updateStatus(value);
        break;

      // Read only
      case DPC_CURRENT_REG:
      case DPC_CLOCK_REG:
      case DPC_BUFBUSY_REG:
      case DPC_PIPEBUSY_REG:
      case DPC_TMEM_REG:
        logger.log('Wrote to read only DPC reg');
        break;

      default:
        this.mem.set32(ea, value);
        break;
    }
  }

  readU32(address) {
    this.logRead(address);
    return this.readRegU32(this.calcReadEA(address));
  }

  readRegU32(ea) {
    if (ea + 4 > this.u8.length) {
      throw 'Read is out of range';
    }
    return this.mem.getU32(ea);
  }

  updateStatus(value) {
    let dpcStatus = this.mem.getU32(DPC_STATUS_REG);

    if (value & DPC_CLR_XBUS_DMEM_DMA) { dpcStatus &= ~DPC_STATUS_XBUS_DMEM_DMA; }
    if (value & DPC_SET_XBUS_DMEM_DMA) { dpcStatus |= DPC_STATUS_XBUS_DMEM_DMA; }
    if (value & DPC_CLR_FREEZE) { dpcStatus &= ~DPC_STATUS_FREEZE; }
    if (value & DPC_SET_FREEZE) { dpcStatus |= DPC_STATUS_FREEZE; }
    if (value & DPC_CLR_FLUSH) { dpcStatus &= ~DPC_STATUS_FLUSH; }
    if (value & DPC_SET_FLUSH) { dpcStatus |= DPC_STATUS_FLUSH; }

    // These should be ignored ! - Salvy
    /*
    if (value & DPC_CLR_TMEM_CTR)          { this.mem.set32(DPC_TMEM_REG, 0); }
    if (value & DPC_CLR_PIPE_CTR)          { this.mem.set32(DPC_PIPEBUSY_REG, 0); }
    if (value & DPC_CLR_CMD_CTR)           { this.mem.set32(DPC_BUFBUSY_REG, 0); }
    if (value & DPC_CLR_CLOCK_CTR)         { this.mem.set32(DPC_CLOCK_REG, 0); }
    */

    this.mem.set32(DPC_STATUS_REG, dpcStatus);
  }

  processBuffer() {
    let rdpBuf
    if (this.xbusDmemDMA) {
      const dv = this.hardware.sp_mem.subRegion(0x0000, 0x1000).dataView;
      rdpBuf = new RDPBuffer(dv, this.currentReg, this.endReg, 0xfff);
    } else {
      const dv = this.hardware.cachedMemDevice.mem.dataView;
      rdpBuf = new RDPBuffer(dv, this.currentReg, this.endReg);
    }

    if (graphicsOptions.dumpRDP) {
      console.log(`Processing RDP buffer: start ${toString32(this.startReg)}, current ${toString32(this.currentReg)}, end ${toString32(this.endReg)}, xbus ${this.xbusDmemDMA}`);
      const dasm = disassembleRange(rdpBuf);
      dasm.forEach(d => {
        console.log(`${toHex(d.address, 24)}: ${d.disassembly}`);
      });
      graphicsOptions.dumpRDP = false;
    }

    this.hardware.rdp.run(rdpBuf);
    this.currentReg = rdpBuf.curAddr;
  }

  syncFull() {
    this.setStatusBits(DPC_STATUS_PIPE_BUSY | DPC_STATUS_START_GCLK, false);
    this.hardware.mi_reg.setBits32(mi.MI_INTR_REG, mi.MI_INTR_DP);
    n64js.cpu0.updateCause3();
  }
}
