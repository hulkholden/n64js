import * as base64 from './base64.js';
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
  }

  createROM(arrayBuffer) {
    this.rom = new MemoryRegion(arrayBuffer);
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
}

function newMemoryRegion(size) {
  return new MemoryRegion(new ArrayBuffer(size));
}
