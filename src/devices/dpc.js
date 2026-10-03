import { Device } from './device.js';
import * as dpc from './dpc_constants.js';
import { toHex, toString32 } from '../format.js';
import * as logger from '../logger.js';
import { RDPBuffer } from '../lle/rdp.js';
import { disassembleRange } from '../hle/disassemble_rdp.js';
import { graphicsOptions } from '../hle/graphics_options.js';

const addressWritableBits = 0x00ff_fff8;
const statusWritableBits = 0x7ff;

export class DPCDevice extends Device {
  constructor(hardware, rangeStart, rangeEnd) {
    super("DPC", hardware, hardware.dpc_mem, rangeStart, rangeEnd);
    this.pendingHLEFullSyncs = 0;
  }

  reset() {
    this.pendingHLEFullSyncs = 0;
  }

  // Raw register values.
  get startReg() { return this.mem.getU32(dpc.DPC_START_REG); }
  get endReg() { return this.mem.getU32(dpc.DPC_END_REG); }
  get currentReg() { return this.mem.getU32(dpc.DPC_CURRENT_REG); }
  get statusReg() { return this.mem.getU32(dpc.DPC_STATUS_REG); }

  set startReg(val) { this.mem.set32(dpc.DPC_START_REG, val & addressWritableBits); }
  set endReg(val) { this.mem.set32(dpc.DPC_END_REG, val & addressWritableBits); }
  set currentReg(val) { this.mem.set32(dpc.DPC_CURRENT_REG, val & addressWritableBits); }
  set statusReg(val) { this.mem.set32(dpc.DPC_STATUS_REG, val & statusWritableBits); }

  setStatusBits(bits, enabled) {
    this.mem.set32masked(dpc.DPC_STATUS_REG, enabled ? bits : 0, bits);
  }

  // Values derived from the registers.
  get xbusDmemDMA() { return (this.statusReg & dpc.DPC_STATUS_XBUS_DMEM_DMA) != 0; }
  get startValid() { return (this.statusReg & dpc.DPC_STATUS_START_VALID) != 0; }
  set startValid(val) { this.setStatusBits(dpc.DPC_STATUS_START_VALID, val); }

  write32(address, value) {
    this.writeReg32(this.calcWriteEA(address), value);
  }

  writeReg32(ea, value) {
    if (ea + 4 > this.u8.length) {
      throw 'Write is out of range';
    }
    switch (ea) {
      case dpc.DPC_START_REG:
        if (!this.quiet) { logger.log(`DPC start set to: ${toString32(value)}`); }

        if (this.startValid) {
          // Subsequent writes to startReg are ignored.
        } else {
          this.startReg = value;
          this.startValid = true;
        }
        break;
      case dpc.DPC_END_REG:
        if (!this.quiet) { logger.log(`DPC end set to: ${toString32(value)}`); }

        if (this.startValid) {
          this.currentReg = this.startReg;
        }
        this.endReg = value;

        this.startValid = false;
        this.setStatusBits(dpc.DPC_STATUS_CBUF_READY | dpc.DPC_STATUS_PIPE_BUSY | dpc.DPC_STATUS_START_GCLK, true);
        this.processBuffer();
        break;
      case dpc.DPC_STATUS_REG:
        //if (!this.quiet) { logger.log(`DPC status set to: ${toString32(value)}` ); }
        this.updateStatus(value);
        break;

      // Read only
      case dpc.DPC_CURRENT_REG:
      case dpc.DPC_CLOCK_REG:
      case dpc.DPC_BUFBUSY_REG:
      case dpc.DPC_PIPEBUSY_REG:
      case dpc.DPC_TMEM_REG:
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
    let dpcStatus = this.mem.getU32(dpc.DPC_STATUS_REG);
    const wasFrozen = (dpcStatus & dpc.DPC_STATUS_FREEZE) !== 0;

    if (value & dpc.DPC_CLR_XBUS_DMEM_DMA) { dpcStatus &= ~dpc.DPC_STATUS_XBUS_DMEM_DMA; }
    if (value & dpc.DPC_SET_XBUS_DMEM_DMA) { dpcStatus |= dpc.DPC_STATUS_XBUS_DMEM_DMA; }
    if (value & dpc.DPC_CLR_FREEZE) { dpcStatus &= ~dpc.DPC_STATUS_FREEZE; }
    if (value & dpc.DPC_SET_FREEZE) { dpcStatus |= dpc.DPC_STATUS_FREEZE; }
    if (value & dpc.DPC_CLR_FLUSH) { dpcStatus &= ~dpc.DPC_STATUS_FLUSH; }
    if (value & dpc.DPC_SET_FLUSH) { dpcStatus |= dpc.DPC_STATUS_FLUSH; }

    if (value & dpc.DPC_CLR_TMEM_CTR)          { this.mem.set32(dpc.DPC_TMEM_REG, 0); }
    if (value & dpc.DPC_CLR_PIPE_CTR)          { this.mem.set32(dpc.DPC_PIPEBUSY_REG, 0); }
    if (value & dpc.DPC_CLR_CMD_CTR)           { this.mem.set32(dpc.DPC_BUFBUSY_REG, 0); }
    if (value & dpc.DPC_CLR_CLOCK_CTR)         { this.mem.set32(dpc.DPC_CLOCK_REG, 0); }

    this.mem.set32(dpc.DPC_STATUS_REG, dpcStatus);
    const frozen = (dpcStatus & dpc.DPC_STATUS_FREEZE) !== 0;
    if (frozen !== wasFrozen) { this.hardware.graphics.setDPFrozen?.(frozen); }
    this.completeHLEFullSyncs();
    if (wasFrozen && !frozen) { this.processBuffer(); }
  }

  processBuffer() {
    if ((this.statusReg & dpc.DPC_STATUS_FREEZE) || this.currentReg === this.endReg) { return; }
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

  syncFullHLE() {
    // HLE can consume an SP display list while the DP is frozen, but must not
    // signal DP completion until it is unfrozen. Banjo-Kazooie uses this to
    // queue its next frame before updating the guest scheduler's DP state.
    this.pendingHLEFullSyncs++;
    this.completeHLEFullSyncs();
  }

  completeHLEFullSyncs() {
    if (!this.pendingHLEFullSyncs || (this.statusReg & dpc.DPC_STATUS_FREEZE)) { return; }

    // HLE runs DP work synchronously without emulating RDP clocks. Credit one
    // nominal clock per executed FullSync so completed work has a nonzero
    // duration (ECW/WWF divide by this counter in their profiling code).
    // This is a compatibility approximation, not a pipeline timing model.
    this.mem.set32(dpc.DPC_CLOCK_REG, (this.mem.getU32(dpc.DPC_CLOCK_REG) + this.pendingHLEFullSyncs) & 0x00ffffff);
    this.pendingHLEFullSyncs = 0;
    this.syncFull();
  }

  syncFull() {
    this.setStatusBits(dpc.DPC_STATUS_PIPE_BUSY | dpc.DPC_STATUS_START_GCLK, false);
    this.hardware.miRegDevice.interruptDP();
  }
}
