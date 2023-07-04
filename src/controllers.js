import * as logger from './logger.js';
import { toString8 } from './format.js';
import { syncInput } from './sync.js';

const PC_CONTROLLER_0 = 0;
const PC_CONTROLLER_1 = 1;
const PC_CONTROLLER_2 = 2;
const PC_CONTROLLER_3 = 3;
const PC_EEPROM = 4;
const PC_UNKNOWN_1 = 5;
const NUM_CHANNELS = 5;

const CONT_GET_STATUS = 0x00;
const CONT_READ_CONTROLLER = 0x01;
const CONT_READ_MEMPACK = 0x02;
const CONT_WRITE_MEMPACK = 0x03;
const CONT_READ_EEPROM = 0x04;
const CONT_WRITE_EEPROM = 0x05;
const CONT_RTC_STATUS = 0x06;
const CONT_RTC_READ = 0x07;
const CONT_RTC_WRITE = 0x08;
const CONT_RESET = 0xff;

const CONT_TX_SIZE_CHANSKIP = 0x00;         // Channel Skip
const CONT_TX_SIZE_DUMMYDATA = 0xFF;         // Dummy Data
const CONT_TX_SIZE_FORMAT_END = 0xFE;         // Format End
const CONT_TX_SIZE_CHANRESET = 0xFD;         // Channel Reset

const kButtonA      = 0x8000;
const kButtonB      = 0x4000;
const kButtonZ      = 0x2000;
const kButtonStart  = 0x1000;
const kButtonJUp    = 0x0800;
const kButtonJDown  = 0x0400;
const kButtonJLeft  = 0x0200;
const kButtonJRight = 0x0100;

const kButtonL      = 0x0020;
const kButtonR      = 0x0010;
const kButtonCUp    = 0x0008;
const kButtonCDown  = 0x0004;
const kButtonCLeft  = 0x0002;
const kButtonCRight = 0x0001;

export class Controllers {
  constructor(hardware) {
    this.hardware = hardware;

    this.controllers = [
      { buttons: 0, stick_x: 0, stick_y: 0, present: true, mempack: true },
      { buttons: 0, stick_x: 0, stick_y: 0, present: true, mempack: false },
      { buttons: 0, stick_x: 0, stick_y: 0, present: true, mempack: false },
      { buttons: 0, stick_x: 0, stick_y: 0, present: true, mempack: false },
    ];

    this.mempack_memory = [
      new Uint8Array(0x400 * 32),
      new Uint8Array(0x400 * 32),
      new Uint8Array(0x400 * 32),
      new Uint8Array(0x400 * 32)
    ];

    this.rumblePakActive = false;
    this.enableRumble = false;
  }

  handleKey(idx, key, down) {
    switch (key) {
      case 'a': this.setButton(idx, kButtonStart, down); break;
      case 's': this.setButton(idx, kButtonA, down); break;
      case 'x': this.setButton(idx, kButtonB, down); break;
      case 'z': this.setButton(idx, kButtonZ, down); break;
      case 'y': this.setButton(idx, kButtonZ, down); break;
      case 'c': this.setButton(idx, kButtonL, down); break;
      case 'v': this.setButton(idx, kButtonR, down); break;

      case 't': this.setButton(idx, kButtonJUp, down); break;
      case 'g': this.setButton(idx, kButtonJDown, down); break;
      case 'f': this.setButton(idx, kButtonJLeft, down); break;
      case 'h': this.setButton(idx, kButtonJRight, down); break;

      case 'i': this.setButton(idx, kButtonCUp, down); break;
      case 'k': this.setButton(idx, kButtonCDown, down); break;
      case 'j': this.setButton(idx, kButtonCLeft, down); break;
      case 'l': this.setButton(idx, kButtonCRight, down); break;

      case 'ArrowLeft': this.setStickX(idx, down ? -80 : 0); break;
      case 'ArrowRight': this.setStickX(idx, down ? +80 : 0); break;
      case 'ArrowDown': this.setStickY(idx, down ? -80 : 0); break;
      case 'ArrowUp': this.setStickY(idx, down ? +80 : 0); break;
      // default: console.log(`unhandled key: ${key}`);
    }
  };

  setStickX(idx, val) {
    this.controllers[idx].stick_x = val;
  }

  setStickY(idx, val) {
    this.controllers[idx].stick_y = val;
  }

  setButton(idx, button, down) {
    let buttons = this.controllers[idx].buttons;
    if (down) {
      buttons |= button;
    } else {
      buttons &= ~button;
    }
    this.controllers[idx].buttons = buttons;
  }

  updateController() {
    // read controllers
    var pi_ram = new Uint8Array(this.hardware.pi_mem.arrayBuffer, 0x7c0, 0x040);

    var count = 0;
    var channel = 0;
    while (count < 64) {
      var cmd = pi_ram.subarray(count);

      if (cmd[0] === CONT_TX_SIZE_FORMAT_END) {
        count = 64;
        break;
      }

      if ((cmd[0] === CONT_TX_SIZE_DUMMYDATA) || (cmd[0] === CONT_TX_SIZE_CHANRESET)) {
        count++;
        continue;
      }

      if (cmd[0] === CONT_TX_SIZE_CHANSKIP) {
        count++;
        channel++;
        continue;
      }

      // 0-3: controller channels
      if (channel < PC_EEPROM) {
        // copy controller status
        if (!this.processController(cmd, channel)) {
          count = 64;
          break;
        }
      } else if (channel === PC_EEPROM) {
        if (!this.processEeprom(cmd)) {
          count = 64;
          break;
        }
        break;
      } else {
        n64js.halt('Trying to read from invalid controller channel ' + channel + '!');
        return;
      }

      channel++;
      count += cmd[0] + (cmd[1] & 0x3f) + 2;
    }

    pi_ram[63] = 0;
  }

  processController(cmd, channel) {
    if (!this.controllers[channel].present) {
      cmd[1] |= 0x80;
      cmd[3] = 0xff;
      cmd[4] = 0xff;
      cmd[5] = 0xff;
      return true;
    }

    var buttons, stick_x, stick_y;

    switch (cmd[2]) {
      case CONT_RESET:
      case CONT_GET_STATUS:
        cmd[3] = 0x05;
        cmd[4] = 0x00;
        cmd[5] = this.controllers[channel].mempack ? 0x01 : 0x00;
        break;

      case CONT_READ_CONTROLLER:

        buttons = this.controllers[channel].buttons;
        stick_x = this.controllers[channel].stick_x;
        stick_y = this.controllers[channel].stick_y;

        if (syncInput) {
          syncInput.sync32(0xbeeff00d, 'input');
          buttons = syncInput.reflect32(buttons); // FIXME reflect16
          stick_x = syncInput.reflect32(stick_x); // FIXME reflect8
          stick_y = syncInput.reflect32(stick_y); // FIXME reflect8
        }

        cmd[3] = buttons >>> 8;
        cmd[4] = buttons & 0xff;
        cmd[5] = stick_x;
        cmd[6] = stick_y;
        break;

      case CONT_READ_MEMPACK:
        if (this.enableRumble) {
          this.commandReadRumblePack(cmd);
        } else {
          this.commandReadMemPack(cmd, channel);
        }
        return false;
      case CONT_WRITE_MEMPACK:
        if (this.enableRumble) {
          this.commandWriteRumblePack(cmd);
        } else {
          this.commandWriteMemPack(cmd, channel);
        }
        return false;
      default:
        n64js.halt('Unknown controller command ' + cmd[2]);
        break;
    }

    return true;
  }

  processEeprom(cmd) {
    var i, offset;

    switch (cmd[2]) {
      case CONT_RESET:
      case CONT_GET_STATUS:
        cmd[3] = 0x00;
        cmd[4] = 0x80; /// FIXME GetEepromContType();
        cmd[5] = 0x00;
        break;

      case CONT_READ_EEPROM:
        offset = cmd[3] * 8;
        logger.log('Reading from eeprom+' + offset);
        for (i = 0; i < 8; ++i) {
          cmd[4 + i] = this.hardware.eeprom.u8[offset + i];
        }
        break;

      case CONT_WRITE_EEPROM:
        offset = cmd[3] * 8;
        logger.log('Writing to eeprom+' + offset);
        for (i = 0; i < 8; ++i) {
          this.hardware.eeprom.u8[offset + i] = cmd[4 + i];
        }
        this.hardware.eepromDirty = true;
        break;

      // RTC credit: Mupen64 source
      //
      case CONT_RTC_STATUS: // RTC status query
        cmd[3] = 0x00;
        cmd[4] = 0x10;
        cmd[5] = 0x00;
        break;

      case CONT_RTC_READ: // read RTC block
        n64js.halt('rtc read unhandled');
        //CommandReadRTC( cmd );
        break;

      case CONT_RTC_WRITE:  // write RTC block
        n64js.halt('rtc write unhandled');
        break;

      default:
        n64js.halt('unknown eeprom command: ' + toString8(cmd[2]));
        break;
    }

    return false;
  }

  calculateDataCrc(buf, offset) {
    var c = 0, i;
    for (i = 0; i < 32; i++) {
      var s = buf[offset + i];

      c = (((c << 1) | ((s >> 7) & 1))) ^ ((c & 0x80) ? 0x85 : 0);
      c = (((c << 1) | ((s >> 6) & 1))) ^ ((c & 0x80) ? 0x85 : 0);
      c = (((c << 1) | ((s >> 5) & 1))) ^ ((c & 0x80) ? 0x85 : 0);
      c = (((c << 1) | ((s >> 4) & 1))) ^ ((c & 0x80) ? 0x85 : 0);
      c = (((c << 1) | ((s >> 3) & 1))) ^ ((c & 0x80) ? 0x85 : 0);
      c = (((c << 1) | ((s >> 2) & 1))) ^ ((c & 0x80) ? 0x85 : 0);
      c = (((c << 1) | ((s >> 1) & 1))) ^ ((c & 0x80) ? 0x85 : 0);
      c = (((c << 1) | ((s >> 0) & 1))) ^ ((c & 0x80) ? 0x85 : 0);
    }

    for (i = 8; i !== 0; i--) {
      c = (c << 1) ^ ((c & 0x80) ? 0x85 : 0);
    }

    return c;
  }

  commandReadMemPack(cmd, channel) {
    var addr = ((cmd[3] << 8) | cmd[4]);
    var i;

    if (addr === 0x8001) {
      for (i = 0; i < 32; ++i) {
        cmd[5 + i] = 0;
      }
    } else {
      // logger.log('Reading from mempack+' + addr);
      addr &= 0xFFE0;

      if (addr <= 0x7FE0) {
        for (i = 0; i < 32; ++i) {
          cmd[5 + i] = this.mempack_memory[channel][addr + i];
        }
      } else {
        // RumblePak
        for (i = 0; i < 32; ++i) {
          cmd[5 + i] = 0;
        }
      }
    }

    cmd[37] = this.calculateDataCrc(cmd, 5);
  }

  commandWriteMemPack(cmd, channel) {
    var addr = ((cmd[3] << 8) | cmd[4]);
    var i;

    if (addr !== 0x8001) {
      logger.log('Writing to mempack+' + addr);
      addr &= 0xFFE0;

      if (addr <= 0x7FE0) {
        for (i = 0; i < 32; ++i) {
          this.mempack_memory[channel][addr + i] = cmd[5 + i];
        }
      } else {
        // Do nothing, eventually enable rumblepak
      }

    }

    cmd[37] = this.calculateDataCrc(cmd, 5);
  }

  commandReadRumblePack(cmd) {
    var addr = ((cmd[3] << 8) | cmd[4]) & 0xFFE0;
    var val = (addr === 0x8000) ? 0x80 : 0x00;
    var i;
    for (i = 0; i < 32; ++i) {
      cmd[5 + i] = val;
    }

    cmd[37] = this.calculateDataCrc(cmd, 5);
  }

  commandWriteRumblePack(cmd) {
    var addr = ((cmd[3] << 8) | cmd[4]) & 0xFFE0;

    if (addr === 0xC000) {
      this.rumblePakActive = cmd[5];
    }

    cmd[37] = this.calculateDataCrc(cmd, 5);
  }
}