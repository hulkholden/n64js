import * as logger from './logger.js';
import { toString16, toString8 } from './format.js';
import { syncInput } from './sync.js';

const PC_CONTROLLER_0 = 0;
const PC_CONTROLLER_1 = 1;
const PC_CONTROLLER_2 = 2;
const PC_CONTROLLER_3 = 3;
const PC_EEPROM = 4;
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

const CONT_TX_SIZE_CHANSKIP = 0x00;  // Channel Skip
const CONT_TX_SIZE_CHANRESET = 0xFD;  // Channel Reset
const CONT_TX_SIZE_FORMAT_END = 0xFE;  // Format End
const CONT_TX_SIZE_DUMMYDATA = 0xFF;  // Dummy Data

const kButtonA = 0x8000;
const kButtonB = 0x4000;
const kButtonZ = 0x2000;
const kButtonStart = 0x1000;
const kButtonJUp = 0x0800;
const kButtonJDown = 0x0400;
const kButtonJLeft = 0x0200;
const kButtonJRight = 0x0100;

const kButtonL = 0x0020;
const kButtonR = 0x0010;
const kButtonCUp = 0x0008;
const kButtonCDown = 0x0004;
const kButtonCLeft = 0x0002;
const kButtonCRight = 0x0001;

const kAttachmentNone = 0;
const kAttachmentControllerPak = 1;
const kAttachmentRumblePak = 2;

class Controller {
  constructor() {
    this.buttons = 0;
    this.stick_x = 0;
    this.stick_y = 0;
    this.present = false;
    this.attachment = kAttachmentNone;

    // For kAttachmentControllerPak.
    this.memory = null;

    // For kAttachmentRumblePak.
    this.rumbleActive = false;
  }

  attachControllerPack(memory) {
    this.attachment = kAttachmentControllerPak;
    this.memory = memory;
  }
}

export class Controllers {
  constructor(hardware) {
    this.hardware = hardware;

    this.controllers = [
      new Controller(),
      new Controller(),
      new Controller(),
      new Controller(),
    ];
    this.controllers[0].present = true;
    this.controllers[0].attachControllerPack(hardware.mempacks[0]);
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
    const pi_ram = new Uint8Array(this.hardware.pi_mem.arrayBuffer, 0x7c0, 0x040);

    let offset = 0;
    let channel = 0;

    while (offset < 64 && channel < NUM_CHANNELS) {
      const cmd = pi_ram.subarray(offset);

      if (cmd[0] === CONT_TX_SIZE_CHANSKIP) {
        offset++;
        channel++;
      } else if (cmd[0] === CONT_TX_SIZE_CHANRESET) {
        // TODO: should send reset command.
        offset++;
        channel++;
      } else if (cmd[0] === CONT_TX_SIZE_FORMAT_END) {
        offset = 64;
        channel = NUM_CHANNELS;
      } else if (cmd[0] === CONT_TX_SIZE_DUMMYDATA) {
        offset++;
      } else {
        // Handle malformed channel command (tx seems valid but rx is 0xfe).
        if (offset + 1 < 64 && cmd[1] == CONT_TX_SIZE_FORMAT_END) {
          offset++;
          continue;
        }

        const tx = cmd[0] & 0x3f;
        const rx = cmd[1] & 0x3f;
        const txBuf = cmd.subarray(2);
        const rxBuf = cmd.subarray(2 + tx);

        if (channel < PC_EEPROM) {
          if (!this.processController(this.controllers[channel], cmd, tx, rx, txBuf, rxBuf)) {
            // Set the invalid bit.
            cmd[1] |= 0x80;
          }
        } else {
          this.processEeprom(cmd);
        }
        channel++;
        offset += 2 + tx + rx;
      }
    }

    pi_ram[63] = 0;
  }

  expectTxRx(cmdName, txGot, txExpect, rxGot, rxExpect) {
    if (txGot != txExpect) {
      logger.log(`${cmdName}: got tx ${txGot} but expect ${txExpect}`)
    }
    if (rxGot != rxExpect) {
      logger.log(`${cmdName}: got rx ${rxGot} but expect ${rxExpect}`)
    }
  }

  processController(controller, buf, tx, rx, txBuf, rxBuf) {
    if (!controller.present) {
      rxBuf[0] = 0xff;
      rxBuf[1] = 0xff;
      rxBuf[2] = 0xff;
      return false;
    }

    const command = txBuf[0];
    switch (command) {
      case CONT_RESET:
        // Reset behaves the same as CONT_GET_STATUS.
        return this.commandGetStatus(controller, tx, rx, txBuf, rxBuf);
      case CONT_GET_STATUS:
        return this.commandGetStatus(controller, tx, rx, txBuf, rxBuf);
      case CONT_READ_CONTROLLER:
        return this.commandReadController(controller, tx, rx, txBuf, rxBuf);
      case CONT_READ_MEMPACK:
        return this.commandReadMemPack(controller, tx, rx, txBuf, rxBuf);
      case CONT_WRITE_MEMPACK:
        return this.commandWriteMemPack(controller, tx, rx, txBuf, rxBuf);
    }

    n64js.halt('Unknown controller command ' + command);
    return false;
  }

  commandGetStatus(controller, tx, rx, txBuf, rxBuf) {
    this.expectTxRx('CONT_GET_STATUS', tx, 1, rx, 3);
    rxBuf[0] = 0x05;
    rxBuf[1] = 0x00;
    rxBuf[2] = controller.attachment == kAttachmentNone ? 0x02 : 0x01;
    return true;
  }

  commandReadController(controller, tx, rx, txBuf, rxBuf) {
    this.expectTxRx('CONT_READ_CONTROLLER', tx, 1, rx, 4);
    let buttons = controller.buttons;
    let stick_x = controller.stick_x;
    let stick_y = controller.stick_y;

    if (syncInput) {
      syncInput.sync32(0xbeeff00d, 'input');
      buttons = syncInput.reflect32(buttons); // FIXME reflect16
      stick_x = syncInput.reflect32(stick_x); // FIXME reflect8
      stick_y = syncInput.reflect32(stick_y); // FIXME reflect8
    }

    rxBuf[0] = buttons >>> 8;
    rxBuf[1] = buttons & 0xff;
    rxBuf[2] = stick_x;
    rxBuf[3] = stick_y;

    // TODO: if rx > expected then set over bit (0x40) in rx byte.
    return true;
  }

  commandReadMemPack(controller, tx, rx, txBuf, rxBuf) {
    this.expectTxRx('CONT_READ_MEMPACK', tx, 3, rx, 33);
    const addr = (txBuf[1] << 8) | (txBuf[2] & 0xe0);
    // const addrCRC = txBuf[2] & 0x1f;

    let handled = false;
    switch (controller.attachment) {
      case kAttachmentControllerPak:
        const data = controller.memory.data;
        for (let i = 0, address = addr; i < (rx - 1); i++, address++) {
          rxBuf[i] = address < data.length ? data[address] : 0;
        }
        handled = true;
        break;
      case kAttachmentRumblePak:
        for (let i = 0, address = addr; i < (rx - 1); i++, address++) {
          let val;
          if (address < 0x8000) val = 0x00;
          else if (address < 0x9000) val = 0x80;
          else val = controller.rumbleActive ? 0xff : 0x00;
          rxBuf[i] = val;
        }
        handled = true;
        break;
    }
    if (handled) {
      rxBuf[rx - 1] = this.calculateDataCrc(rxBuf, 0, rx - 1);
    }
    return handled;
  }

  commandWriteMemPack(controller, tx, rx, txBuf, rxBuf) {
    this.expectTxRx('CONT_WRITE_MEMPACK', tx, 35, rx, 1);
    const addr = (txBuf[1] << 8) | (txBuf[2] & 0xe0);
    // const addrCRC = txBuf[2] & 0x1f;

    let handled = false;
    switch (controller.attachment) {
      case kAttachmentControllerPak:
        const data = controller.memory.data;
        controller.memory.dirty = true;
        for (let i = 0, address = addr; i < (tx - 3); i++, address++) {
          if (address < data.length) {
            data[address] = txBuf[3 + i];
          }
        }
        handled = true;
        break;
      case kAttachmentRumblePak:
        if (addr >= 0xC000) {
          controller.rumbleActive = txBuf[3] & 1;
        }
        handled = true;
        break;
    }
    if (handled) {
      rxBuf[rx - 1] = this.calculateDataCrc(txBuf, 3, tx - 3);
    }
    return handled;
  }

  processEeprom(cmd) {
    switch (cmd[2]) {
      case CONT_RESET:
      case CONT_GET_STATUS:
        cmd[3] = 0x00;
        cmd[4] = 0x80; /// FIXME this.hardware.eeprom.u8.length > 4k ? 0xc0 : 0x80.
        cmd[5] = 0x00;
        break;

      case CONT_READ_EEPROM:
        {
          const offset = cmd[3] * 8;
          logger.log('Reading from eeprom+' + offset);
          for (let i = 0; i < 8; ++i) {
            cmd[4 + i] = this.hardware.eeprom.u8[offset + i];
          }
        }
        break;

      case CONT_WRITE_EEPROM:
        {
          const offset = cmd[3] * 8;
          logger.log('Writing to eeprom+' + offset);
          for (let i = 0; i < 8; ++i) {
            this.hardware.eeprom.u8[offset + i] = cmd[4 + i];
          }
          this.hardware.eepromDirty = true;
        }
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

  calculateDataCrc(buf, offset, bytes) {
    var c = 0, i;
    for (i = 0; i < bytes; i++) {
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

    return c & 0xff;
  }
}