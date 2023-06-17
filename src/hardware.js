import * as base64 from './base64.js';
import { AIRegDevice } from './devices/ai.js';
import { DPCDevice } from './devices/dpc.js';
import { DPSDevice } from './devices/dps.js';
import { MIRegDevice } from './devices/mi.js';
import { PIRegDevice, PIRamDevice } from './devices/pi.js';
import { MappedMemDevice, CachedMemDevice, UncachedMemDevice, RDRamRegDevice } from './devices/ram.js';
import { RIRegDevice } from './devices/ri.js';
import { ROMD1A1Device, ROMD1A2Device, ROMD1A3Device, ROMD2A1Device, ROMD2A2Device } from './devices/rom.js';
import { SIRegDevice } from './devices/si.js';
import { SPMemDevice, SPIBISTDevice, SPRegDevice } from './devices/sp.js';
import { VIRegDevice } from './devices/vi.js';
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

    this.eeprom = null;   // Initialised during reset, using correct size for this rom (may be null if eeprom isn't used)
    this.eepromDirty = false;

    this.mappedMemDevice   = new MappedMemDevice(this, 0x00000000, 0x80000000);
    this.cachedMemDevice   = new CachedMemDevice(this, 0x80000000, 0x80800000);
    this.uncachedMemDevice = new UncachedMemDevice(this, 0xa0000000, 0xa0800000);
    this.rdRamRegDevice = new RDRamRegDevice(this, 0xa3f00000, 0xa4000000);
    this.spMemDevice    = new SPMemDevice(this, 0xa4000000, 0xa4002000);
    this.spRegDevice    = new SPRegDevice(this, 0xa4040000, 0xa4040020);
    this.spIbistDevice  = new SPIBISTDevice(this, 0xa4080000, 0xa4080008);
    this.dpcDevice      = new DPCDevice(this, 0xa4100000, 0xa4100020);
    this.dpsDevice      = new DPSDevice(this, 0xa4200000, 0xa4200010);
    this.miRegDevice    = new MIRegDevice(this, 0xa4300000, 0xa4300010);
    this.viRegDevice    = new VIRegDevice(this, 0xa4400000, 0xa4400038);
    this.aiRegDevice    = new AIRegDevice(this, 0xa4500000, 0xa4500018);
    this.piRegDevice    = new PIRegDevice(this, 0xa4600000, 0xa4600034);
    this.riRegDevice    = new RIRegDevice(this, 0xa4700000, 0xa4700020);
    this.siRegDevice    = new SIRegDevice(this, 0xa4800000, 0xa480001c);
    this.romD2A1Device  = new ROMD2A1Device(this, 0xa5000000, 0xa6000000);
    this.romD1A1Device  = new ROMD1A1Device(this, 0xa6000000, 0xa8000000);
    this.romD2A2Device  = new ROMD2A2Device(this, 0xa8000000, 0xb0000000);
    this.romD1A2Device  = new ROMD1A2Device(this, 0xb0000000, 0xbfc00000);
    this.piMemDevice    = new PIRamDevice(this, 0xbfc00000, 0xbfc00800);
    this.romD1A3Device  = new ROMD1A3Device(this, 0xbfd00000, 0xc0000000);

    this.devices = [
      this.mappedMemDevice,
      this.cachedMemDevice,
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
      this.piMemDevice,
      this.romD1A3Device,
    ];
  
    // TODO: Not sure this belongs here.
    this.rominfo = rominfo;
  }

  reset() {
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

    this.initSaveGame();

    this.piRegDevice.reset();
    this.miRegDevice.reset();
    this.riRegDevice.reset();
  }

  createROM(arrayBuffer) {
    const rom = new MemoryRegion(arrayBuffer);
    this.rom = rom;
    this.romD1A1Device.setMem(rom);
    this.romD1A2Device.setMem(rom);
    this.romD1A3Device.setMem(rom);
    return rom;
  }

  initSaveGame() {
    this.eeprom = null;
    this.eepromDirty = false;

    switch (this.rominfo.save) {
      case 'Eeprom4k':
       this.initEeprom(4 * 1024, n64js.getLocalStorageItem('eeprom'));
        break;
      case 'Eeprom16k':
       this.initEeprom(16 * 1024, n64js.getLocalStorageItem('eeprom'));
        break;

      default:
        if (this.rominfo.save) {
          n64js.displayWarning('Unhandled savegame type: ' + this.rominfo.save + '.');
        }
    }
  }

  initEeprom(size, eeprom_data) {
    var memory = new MemoryRegion(new ArrayBuffer(size));
    if (eeprom_data && eeprom_data.data) {
      base64.decodeArray(eeprom_data.data, memory.u8);
    }
    this.eeprom = memory;
    this.eepromDirty = false;
  }

  saveEeprom() {
    if (this.eeprom && this.eepromDirty) {

      var encoded = base64.encodeArray(this.eeprom.u8);

      // Store the name and id so that we can provide some kind of save management in the future
      var d = {
        name: this.rominfo.name,
        id: this.rominfo.id,
        data: encoded
      };

      n64js.setLocalStorageItem('eeprom', d);
      this.eepromDirty = false;
    }
  }

  checkSIStatusConsistent() {
    this.siRegDevice.checkStatusConsistent();
  }
}

function newMemoryRegion(size) {
  return new MemoryRegion(new ArrayBuffer(size));
}
