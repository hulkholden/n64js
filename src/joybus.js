import * as logger from './logger.js';
import { toString16, toString8 } from './format.js';
import { syncInput } from './sync.js';
import { ControllerInputs } from './controllers.js';

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

// Joybus interpreset certain tx sizes in a special way.
const kJoybusTxChanSkip = 0x00;  // Channel Skip
const kJoybusTxChanReset = 0xfd;  // Channel Reset
const kJoybusTxFormatEnd = 0xfe;  // Format End
const kJoybusTxDummyData = 0xff;  // Dummy Data

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
  /**
   * Constructs a new Joybus instance.
   * @param {Hardware} hardware An instance of Hardware.
   * @param {Array<ControllerInputs>} inputs A list of ControllerInputs instances.
   */
  constructor(hardware, inputs) {
    this.hardware = hardware;

    const controller0 = new ControllerChannel(inputs[0]);
    controller0.present = true;
    controller0.attachControllerPack(hardware.mempacks[0]);

    this.channels = [
      controller0,
      new ControllerChannel(inputs[1]),
      new ControllerChannel(inputs[2]),
      new ControllerChannel(inputs[3]),
      new CartridgeChannel(hardware),
    ];
  }

  execute() {
    const pifRam = new Uint8Array(this.hardware.pif_mem.arrayBuffer, 0x7c0, 0x040);

    let channel = 0;
    const piframSize = 64;
    for (let offset = 0; offset < piframSize && channel < kNumChannels; offset++) {
      const cmd = pifRam.subarray(offset);
      switch (cmd[0]) {
        case kJoybusTxChanSkip:
          channel++;
          break;
        case kJoybusTxChanReset:
          // TODO: should send reset command.
          channel++;
          break;
        case kJoybusTxFormatEnd:
          offset = piframSize;
          break;
        case kJoybusTxDummyData:
          break;
        default:
          if (offset + 1 < piframSize) {
            const tx = cmd[0] & 0x3f;
            const rx = cmd[1] & 0x3f;
            const txOff = 2;  // 2 bytes for tx and rx.
            const txEnd = txOff + tx;
            const rxOff = txEnd;
            const rxEnd = rxOff + rx;
            const txBuf = cmd.subarray(txOff, txEnd);
            const rxBuf = cmd.subarray(rxOff, rxEnd);

            // Handle malformed channel command (tx seems valid but rx is 0xfe).
            if (cmd[1] == kJoybusTxFormatEnd) {
              offset++;
              break;
            }

            // Perform the command and find out how many bytes were returned.        
            // If an unexpected number of bytes were received, set status bits in rx.
            const rxLen = this.channels[channel].joybusCommand(tx, rx, txBuf, rxBuf);
            if (rxLen < rx) { cmd[1] |= kResponseUnder; }
            if (rxLen > rx) { cmd[1] |= kResponseOver; }

            // Skip past the data (one additional byte will be skipped in for loop) and
            // move to the next channel.
            offset += rxEnd - 1;
            channel++;
          }
          break;
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

class ControllerChannel {
  /**
   * Construct a new ControllerChannel instance.
   * @param {ControllerInputs} inputs An instance of ControllerInputs.
   */
  constructor(inputs) {
    this.inputs = inputs;
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

    let buttons = this.inputs.buttons;
    let stick_x = this.inputs.stick_x;
    let stick_y = this.inputs.stick_y;

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

class CartridgeChannel {
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