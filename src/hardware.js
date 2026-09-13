/*global n64js*/

import { CPU1 } from './cpu1.js';
import { AIRegDevice } from './devices/ai.js';
import { DPCDevice } from './devices/dpc.js';
import { DPSDevice } from './devices/dps.js';
import { MIRegDevice } from './devices/mi.js';
import { PIRegDevice } from './devices/pi.js';
import { PIFMemDevice, PIF_RAM_OFFSET } from './devices/pif.js';
import { MappedMemDevice, CachedMemDevice, UncachedMemDevice, InvalidMemDevice, RDRamRegDevice } from './devices/ram.js';
import { RIRegDevice } from './devices/ri.js';
import { ROMD1A1Device, ROMD1A2Device, ROMD1A3Device, ROMD2A1Device, ROMD2A2Device } from './devices/rom.js';
import { SIRegDevice } from './devices/si.js';
import { SPMemDevice, SPIBISTDevice, SPRegDevice } from './devices/sp.js';
import { VIRegDevice } from './devices/vi.js';
import { RDP } from './lle/rdp.js';
import { MemoryMap } from './memmap.js';
import { Mempack } from './mempack.js';
import { MemoryRegion } from './memory_region.js';
import { CPU0, CPU2 } from './r4300.js';
import { RSP } from './rsp.js';
import { Timeline } from './timeline.js';

const kBootstrapOffset = 0x40;
const kGameOffset = 0x1000;

const systemFrequency = 93_750_000;

export class Hardware {
  constructor(rominfo, {
    headless = false,
    enableCompatibilityHacks = true,
    graphics = { processTask() {}, reset() {} },
    onVerticalBlank = null,
    onGraphicsTask = null,
    onMicrocodeLoad = null,
    onTextureUse = null,
  } = {}) {
    // TODO: Not sure this belongs here.
    this.rominfo = rominfo;
    this.headless = headless;
    this.enableCompatibilityHacks = enableCompatibilityHacks;
    // The environment supplies a synchronous graphics processor with
    // processTask(task) and reset(). The default skips HLE display lists.
    this.graphics = graphics;
    this.verticalBlankCount = 0;
    // Called synchronously after each VI interrupt with the count since reset.
    // Resets preserve the callback. It must not re-enter emulation.
    this.onVerticalBlank = onVerticalBlank;
    // Called synchronously at each graphics-task start, before HLE/LLE dispatch,
    // including in headless mode. Receives a fresh identifyMicrocode() snapshot
    // of the initial microcode; in-list switches are not reported. Repeated
    // starts are reported separately. Resets preserve the callback, which must
    // not re-enter emulation. Its return value is ignored.
    this.onGraphicsTask = onGraphicsTask;
    // Called synchronously after each HLE graphics microcode handler is constructed,
    // including initial loads, in-list loads, and browser debugger replays.
    // Receives a fresh identifyMicrocode() snapshot. Skipped/LLE tasks do not
    // construct HLE handlers. Resets preserve the callback; it must not re-enter
    // emulation, and its return value is ignored.
    this.onMicrocodeLoad = onMicrocodeLoad;
    // Called synchronously for each nonempty tile selected by an HLE textured
    // draw (once per triangle batch or rectangle), including debugger replays.
    // Receives a fresh { format, size } snapshot using the GBI enum values.
    // This observes renderer inputs, not visible pixels or successful decoding.
    // Resets preserve the callback; it must not re-enter emulation. Its return
    // value is ignored, and skipped/LLE tasks do not report texture use.
    this.onTextureUse = onTextureUse;

    this.timeline = new Timeline(this.getOpsExecuted.bind(this));

    this.systemFrequency = systemFrequency;

    this.rom = null;   // Will be memory, mapped at 0xb0000000
    this.pif_mem = newMemoryRegion(PIF_RAM_OFFSET + 0x40);   // rom+ram
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

    // Initialised during reset, using correct size for this rom (may be null if eeprom/sram/flash isn't used)
    // TODO: add a dirty flag and persist to local storage.
    this.saveMem = null;
    this.saveDirty = false;

    this.mempacks = [
      new Mempack(),
      new Mempack(),
      new Mempack(),
      new Mempack(),
    ];

    // KUSEG, TLB mapped.
    this.mappedMemDevice = new MappedMemDevice(this, 0x00000000, 0x80000000);
    // KSEG0, directly mapped, cached.
    this.invalidCachedMemDevice = new InvalidMemDevice(this, 0x80000000, 0xa0000000);
    this.cachedMemDevice = new CachedMemDevice(this, 0x80000000, 0x80800000);
    // KSEG1, directly mapped, uncached.
    this.invalidUnachedMemDevice = new InvalidMemDevice(this, 0xa0000000, 0xc0000000);
    this.uncachedMemDevice = new UncachedMemDevice(this, 0xa0000000, 0xa0800000);
    this.rdRamRegDevice = new RDRamRegDevice(this, 0xa3f00000, 0xa4000000);
    this.spMemDevice = new SPMemDevice(this, 0xa4000000, 0xa4040000);  // Mem is only 0x2000 bytes, but wraps.
    this.spRegDevice = new SPRegDevice(this, 0xa4040000, 0xa4040020);
    this.spIbistDevice = new SPIBISTDevice(this, 0xa4080000, 0xa4080008);
    this.dpcDevice = new DPCDevice(this, 0xa4100000, 0xa4100020);
    this.dpsDevice = new DPSDevice(this, 0xa4200000, 0xa4200010);
    this.miRegDevice = new MIRegDevice(this, 0xa4300000, 0xa4300010);
    this.viRegDevice = new VIRegDevice(this, 0xa4400000, 0xa4400038);
    this.aiRegDevice = new AIRegDevice(this, 0xa4500000, 0xa4500018);
    this.piRegDevice = new PIRegDevice(this, 0xa4600000, 0xa4600034);
    this.riRegDevice = new RIRegDevice(this, 0xa4700000, 0xa4700020);
    this.siRegDevice = new SIRegDevice(this, 0xa4800000, 0xa480001c);
    this.romD2A1Device = new ROMD2A1Device(this, 0xa5000000, 0xa6000000);
    this.romD1A1Device = new ROMD1A1Device(this, 0xa6000000, 0xa8000000);
    this.romD2A2Device = new ROMD2A2Device(this, 0xa8000000, 0xb0000000);
    this.romD1A2Device = new ROMD1A2Device(this, 0xb0000000, 0xbfc00000);
    this.pifMemDevice = new PIFMemDevice(this, 0xbfc00000, 0xbfc00800);
    this.romD1A3Device = new ROMD1A3Device(this, 0xbfd00000, 0xc0000000);
    // KSSEG, TLB mapped.
    this.mappedMem2Device = new MappedMemDevice(this, 0xc0000000, 0xe0000000);
    // KSEG3, TLB mapped.
    this.mappedMem3Device = new MappedMemDevice(this, 0xe0000000, 0x1_00000000);

    this.devices = [
      this.mappedMemDevice,
      // Register the invalid memory device before all the other KSEG0 devices.
      this.invalidCachedMemDevice,
      this.cachedMemDevice,
      // Register the invalid memory device before all the other KSEG1 devices.
      this.invalidUnachedMemDevice,
      this.uncachedMemDevice,
      this.rdRamRegDevice,
      this.spMemDevice,
      this.spRegDevice,
      this.spIbistDevice,
      this.dpcDevice,
      this.dpsDevice,
      this.miRegDevice,
      this.viRegDevice,
      this.aiRegDevice,
      this.piRegDevice,
      this.riRegDevice,
      this.siRegDevice,
      this.romD2A1Device,
      this.romD1A1Device,
      this.romD2A2Device,
      this.romD1A2Device,
      this.pifMemDevice,
      this.romD1A3Device,
      this.mappedMem2Device,
      this.mappedMem3Device,
    ];
    this.memMap = new MemoryMap(this.devices);

    this.cpu0 = new CPU0(this);
    this.cpu1 = new CPU1(this);
    this.cpu2 = new CPU2(this);
    this.rsp = new RSP(this);
    this.rdp = new RDP(this);
  }

  reset() {
    this.verticalBlankCount = 0;
    this.graphics.reset();
    this.cpu0.reset();
    this.cpu1.reset();
    this.cpu2.reset();
 
    this.pif_mem.clear();
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

    this.initSaveGame();

    for (let d of this.devices) {
      d.reset();
    }
  }

  getOpsExecuted() {
    return this.cpu0.getOpsExecuted();
  }

  createROM(arrayBuffer) {
    // Ensure the rom array buffer is at least 8MB.
    // This helps ensure MemoryRegion.copy won't assert when DMAing from short roms.
    const minLength = 8 * 1024 * 1024;
    if (Math.max(arrayBuffer.byteLength < minLength)) {
      arrayBuffer = arrayBuffer.transfer(minLength);
    }
    const rom = new MemoryRegion(arrayBuffer);
    this.rom = rom;
    this.romD1A1Device.setMem(rom);
    this.romD1A2Device.setMem(rom);
    this.romD1A3Device.setMem(rom);
    return rom;
  }

  loadROM() {
    if (this.rom) {
      this.sp_mem.copy(kBootstrapOffset, this.rom, kBootstrapOffset, kGameOffset - kBootstrapOffset);
    }
  }

  verticalBlank() {
    this.verticalBlankCount++;
    this.flushSaveData();

    this.timeline.newFrame();
  }

  initSaveGame() {
    for (let [i, mp] of this.mempacks.entries()) {
      const item = n64js.getLocalStorageItem(`mempack${i}`);
      mp.init(item);
    }

    const saveSize = this.saveSizeBytes();
    if (saveSize) {
      const memory = new MemoryRegion(new ArrayBuffer(saveSize));
      const saveItem = n64js.getLocalStorageItem('save');
      if (saveItem && saveItem.data) {
        const arr = Uint8Array.fromBase64(saveItem.data);
        for (let i = 0; i < arr.length && i < memory.u8.length; i++) {
          memory.u8[i] = arr[i];
        }
      }
      this.saveMem = memory;
    } else {
      this.saveMem = null;
    }
    this.saveDirty = false;
  }

  saveSizeBytes() {
    switch (this.saveType) {
      case 'Eeprom4k': return 4 * 1024 / 8;
      case 'Eeprom16k': return 16 * 1024 / 8;
      case 'SRAM': return 32 * 1024;
      case 'SRAM96k': return 96 * 1024;
      case 'FlashRam': return 128 * 1024;
    }
    if (this.saveType) {
      n64js.ui().displayWarning(`Unhandled savegame type: ${this.saveType}.`);
    }
    return 0;
  }

  get saveType() { return this.rominfo.save; }

  flushSaveData() {
    if (this.saveMem && this.saveDirty) {
      this.saveU8Array('save', this.saveMem.u8);
      this.saveDirty = false;
    }

    for (let [i, mp] of this.mempacks.entries()) {
      if (mp.dirty) {
        this.saveU8Array(`mempack${i}`, mp.data);
        mp.dirty = false;
      }
    }
  }

  saveU8Array(name, u8arr) {
    // Store the name and id so that we can provide some kind of save management in the future
    const d = {
      name: this.rominfo.name,
      id: this.rominfo.id,
      data: u8arr.toBase64(),
    };
    n64js.setLocalStorageItem(name, d);
  }

  checkSIStatusConsistent() {
    this.siRegDevice.checkStatusConsistent();
  }
}

function newMemoryRegion(size) {
  return new MemoryRegion(new ArrayBuffer(size));
}
