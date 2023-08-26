import * as logger from './logger.js';
import { toString16, toString8 } from './format.js';
import { syncInput } from './sync.js';

const kChanController0 = 0;
const kChanController1 = 1;
const kChanController2 = 2;
const kChanController3 = 3;
const kChanCartridge = 4;
const kNumChannels = 5;

const kCmdGetStatus = 0x00;
const kCmdControllerRead = 0x01;
const kCmdControllerAccessoryRead = 0x02;
const kCmdControllerAccessoryWrite = 0x03;
const kCmdEepromRead = 0x04;
const kCmdEepromWrite = 0x05;
const kCmdRTCInfo = 0x06;
const kCmdRTCRead = 0x07;
const kCmdRTCWrite = 0x08;
const kCmdReset = 0xff;

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

// Device IDs returned in kCmdGetStatus status.
const kDeviceIDRTC = 0x0010;
const kDeviceIDEeprom4K = 0x0080;
const kDeviceIDEeprom16K = 0x00c0;
const kDeviceIDController = 0x0500;
const kDeviceIDDisconnected = 0xffff;

// Responses returned in rx byte when unexpected number of bytes returned.
const kResponseOver = 0x40;  // Too many bytes returned.
const kResponseUnder = 0x80;  // Too few bytes returned.

export class Joybus {
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

    this.cartridge = new Cartridge(hardware);

    // A buffer used to make it easier to handle truncated output.
    this.tempOutput = new Uint8Array(64);
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

  execute() {
    const pifRam = new Uint8Array(this.hardware.pif_mem.arrayBuffer, 0x7c0, 0x040);

    let offset = 0;
    let channel = 0;

    while (offset < 64 && channel < kNumChannels) {
      const cmd = pifRam.subarray(offset);

      if (cmd[0] === CONT_TX_SIZE_CHANSKIP) {
        offset++;
        channel++;
      } else if (cmd[0] === CONT_TX_SIZE_CHANRESET) {
        // TODO: should send reset command.
        offset++;
        channel++;
      } else if (cmd[0] === CONT_TX_SIZE_FORMAT_END) {
        offset = 64;
        channel = kNumChannels;
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

        // Provide a full sized output buffer so that commands don't need to handle
        // truncated output in the handlers.
        for (let i = 0; i < rx; i++) {
          this.tempOutput[i] = 0;
        }

        // Handlers return how many bytes were written to tempOutput.
        let rxLen;
        if (channel < kChanCartridge) {
          rxLen = this.controllers[channel].joybusCommand(tx, rx, txBuf, this.tempOutput);
        } else {
          rxLen = this.cartridge.joybusCommand(tx, rx, txBuf, this.tempOutput)
        }

        // If an unexpected number of bytes were received, set status bits in rx.
        if (rxLen < rx) {
          cmd[1] |= kResponseUnder;
        } else if (rxLen > rx) {
          cmd[1] |= kResponseOver;
          rxLen = rx;
        }
        // Copy response bytes.
        for (let i = 0; i < rxLen; i++) {
          rxBuf[i] = this.tempOutput[i];
        }

        // Move to the next channel.
        channel++;
        offset += 2 + tx + rx;
      }
    }

    pifRam[63] = 0;
  }
}

function calculateDataCrc(buf, offset, bytes) {
  let c = 0;
  for (let i = 0; i < bytes; i++) {
    const s = buf[offset + i];
    for (let b = 0; b < 8; b++) {
      c = ((c << 1) | ((s >>> (7 - b)) & 1)) ^ ((c & 0x80) ? 0x85 : 0);
    }
  }

  for (let i = 8; i !== 0; i--) {
    c = (c << 1) ^ ((c & 0x80) ? 0x85 : 0);
  }
  return c & 0xff;
}

function calculateAddressCrc(address) {
  let c = 0;
  for (let i = 0; i < 16; i++) {
    c = ((c << 1) | ((address >>> (15 - i)) & 1)) ^ ((c & 0x10) ? 0x15 : 0);
  }
  return c & 0x1f;
}

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

  joybusCommand(tx, rx, txBuf, rxBuf) {
    if (!this.present) {
      return 0;
    }

    const command = txBuf[0];
    switch (command) {
      case kCmdReset:
        // Reset behaves the same as kCmdGetStatus.
        return this.getStatus(tx, rx, txBuf, rxBuf);
      case kCmdGetStatus:
        return this.getStatus(tx, rx, txBuf, rxBuf);
      case kCmdControllerRead:
        return this.readController(tx, rx, txBuf, rxBuf);
      case kCmdControllerAccessoryRead:
        return this.readAccessory(tx, rx, txBuf, rxBuf);
      case kCmdControllerAccessoryWrite:
        return this.writeAccessory(tx, rx, txBuf, rxBuf);
    }

    n64js.halt('Unknown controller command ' + command);
    return 0;
  }

  expectTx(cmdName, txGot, txExpect) {
    if (txGot != txExpect) {
      logger.log(`${cmdName}: got tx ${txGot} but expect ${txExpect}`)
    }
  }

  getStatus(tx, rx, txBuf, rxBuf) {
    this.expectTx('kCmdGetStatus', tx, 1);

    // Device ID.
    rxBuf[0] = (kDeviceIDController >>> 8);
    rxBuf[1] = (kDeviceIDController & 0xff);
    // Status.
    rxBuf[2] = this.attachment == kAttachmentNone ? 0x02 : 0x01;
    return 3;
  }

  readController(tx, rx, txBuf, rxBuf) {
    this.expectTx('kCmdControllerRead', tx, 1);

    let buttons = this.buttons;
    let stick_x = this.stick_x;
    let stick_y = this.stick_y;

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
    return 4;
  }

  readAccessory(tx, rx, txBuf, rxBuf) {
    this.expectTx('kCmdControllerAccessoryRead', tx, 3);

    const addr = (txBuf[1] << 8) | (txBuf[2] & 0xe0);
    const addrCRC = txBuf[2] & 0x1f;
    if (addrCRC != calculateAddressCrc(addr)) {
      return 0;
    }

    switch (this.attachment) {
      case kAttachmentControllerPak:
        const data = this.memory.data;
        for (let i = 0, address = addr; i < (rx - 1); i++, address++) {
          rxBuf[i] = address < data.length ? data[address] : 0;
        }
        break;
      case kAttachmentRumblePak:
        for (let i = 0, address = addr; i < (rx - 1); i++, address++) {
          let val;
          if (address < 0x8000) val = 0x00;
          else if (address < 0x9000) val = 0x80;
          else val = this.rumbleActive ? 0xff : 0x00;
          rxBuf[i] = val;
        }
        break;

      default:
        return 0;
    }
    rxBuf[rx - 1] = calculateDataCrc(rxBuf, 0, rx - 1);
    return rx;
  }

  writeAccessory(tx, rx, txBuf, rxBuf) {
    this.expectTx('kCmdControllerAccessoryWrite', tx, 35);

    const addr = (txBuf[1] << 8) | (txBuf[2] & 0xe0);
    const addrCRC = txBuf[2] & 0x1f;
    if (addrCRC != calculateAddressCrc(addr)) {
      return 0;
    }

    switch (this.attachment) {
      case kAttachmentControllerPak:
        const data = this.memory.data;
        this.memory.dirty = true;
        for (let i = 0, address = addr; i < (tx - 3); i++, address++) {
          if (address < data.length) {
            data[address] = txBuf[3 + i];
          }
        }
        break;
      case kAttachmentRumblePak:
        if (addr >= 0xC000) {
          this.rumbleActive = txBuf[3] & 1;
        }
        break;

      default:
        return 0;
    }
    rxBuf[rx - 1] = calculateDataCrc(txBuf, 3, tx - 3);
    return rx;
  }
}

class Cartridge {
  constructor(hardware) {
    this.hardware = hardware
  }

  expectTx(cmdName, txGot, txExpect) {
    if (txGot != txExpect) {
      logger.log(`${cmdName}: got tx ${txGot} but expect ${txExpect}`)
    }
  }

  joybusCommand(tx, rx, txBuf, rxBuf) {
    const command = txBuf[0];
    switch (command) {
      case kCmdReset:
        return this.getStatus(tx, rx, txBuf, rxBuf);
      case kCmdGetStatus:
        return this.getStatus(tx, rx, txBuf, rxBuf);
      case kCmdEepromRead:
        return this.readEeprom(tx, rx, txBuf, rxBuf);
      case kCmdEepromWrite:
        return this.writeEeprom(tx, rx, txBuf, rxBuf);
      case kCmdRTCInfo:
        return this.rtcStatus(tx, rx, txBuf, rxBuf);
      case kCmdRTCRead:
        return this.rtcRead(tx, rx, txBuf, rxBuf);
      case kCmdRTCWrite:
        return this.rtcWrite(tx, rx, txBuf, rxBuf);
    }

    n64js.halt(`Unknown cartridge command: ${command}`);
    return 0;
  }

  getStatus(tx, rx, txBuf, rxBuf) {
    this.expectTx('kCmdGetStatus', tx, 1);

    const eeprom = this.hardware.eeprom;
    if (!eeprom) {
      console.log(`no eeprom`)
      return 0;
    }

    // Device ID.
    const id = (eeprom.u8.length == 512) ? kDeviceIDEeprom4K : kDeviceIDEeprom16K;
    rxBuf[0] = (id >>> 8);
    rxBuf[1] = (id & 0xff);
    // Status.
    rxBuf[2] = 0x00;
    return 3;
  }

  readEeprom(tx, rx, txBuf, rxBuf) {
    this.expectTx('kCmdEepromRead', tx, 2);

    // TODO: In a 512 byte EEPROM, the top two bits of block number are ignored: blocks 64-255 are repeats of the first 64

    const offset = txBuf[1] * 8;
    for (let i = 0; i < rx; ++i) {
      rxBuf[i] = this.hardware.eeprom.u8[offset + i];
    }
    return rx;
  }

  writeEeprom(tx, rx, txBuf, rxBuf) {
    this.expectTx('kCmdEepromWrite', tx, 10);

    const offset = txBuf[1] * 8;
    for (let i = 0; i < tx - 2; ++i) {
      this.hardware.eeprom.u8[offset + i] = txBuf[2 + i];
    }
    this.hardware.eepromDirty = true;

    // Response byte. Could send 0x80 if busy.
    rxBuf[0] = 0;
    return 1;
  }

  rtcStatus(tx, rx, txBuf, rxBuf) {
    // Device ID.
    rxBuf[0] = (kDeviceIDRTC >>> 8);
    rxBuf[1] = (kDeviceIDRTC & 0xff);
    // Status.
    rxBuf[2] = 0x00;
    return 3;
  }

  rtcRead(tx, rx, txBuf, rxBuf) {
    n64js.warn('rtc read unhandled');
    return 0;
  }
  rtcWrite(tx, rx, txBuf, rxBuf) {
    n64js.warn('rtc write unhandled');
    return 0;
  }
}