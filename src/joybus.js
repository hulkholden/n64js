/*global n64js*/

import * as logger from './logger.js';
import { syncInput } from './sync.js';
import { n64_cic_nus_6105 } from './devices/cic.js';

// Channels 0..3 are for controllers and channel 4 is for the cart.
const kNumChannels = 5;

const kPIFRamSize = 64;
const kPIFRamControlByte = 63;

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

    this.pifRam = this.hardware.pif_mem.subRegion(0x7c0, 0x040);

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

  get controlByte() { return this.pifRam.getU8(kPIFRamControlByte); }
  set controlByte(v) { this.pifRam.set8(kPIFRamControlByte, v); }

  cpuRead(offset) {
    // TODO: handle reads from the control byte from the CPU here.
    // console.log(`cpuRead, at ${offset}, command is ${this.controlByte}`)
  }

  cpuWrite(offset) {
    // TODO: handle writes to the control byte from the CPU here.
    // console.log(`cpuWrite, at ${offset}, command is ${this.controlByte}`)
  }

  dmaWrite(src, srcOffset) {
    this.pifRam.copy(0, src, srcOffset, kPIFRamSize);

    if (this.controlByte & 1) {
      this.controlByte &= ~1;
      this.configure();
    }
  }

  dmaRead(dst, dstOffset) {
    if (this.controlByte & 2) {
      this.processCICChallenge();
    } else {
      this.execute();
    }
    dst.copy(dstOffset, this.pifRam, 0, kPIFRamSize);
  }

  processCICChallenge() {
    const challenge = new Uint8Array(30);
    const response = new Uint8Array(30);

    // TODO: this should depend on which CIC chip is present.

    // Convert challenge bytes into nibbles.
    for (let i = 0; i < 15; ++i) {
      challenge[i * 2 + 0] = (this.pifRam.u8[0x30 + i] >>> 4) & 0x0f;
      challenge[i * 2 + 1] = (this.pifRam.u8[0x30 + i] >>> 0) & 0x0f;
    }

    // Compute the response.
    n64_cic_nus_6105(challenge, response, 30);

    // Convert response nibbles into bytes.
    for (let i = 0; i < 15; ++i) {
      this.pifRam.u8[0x30 + i] = (response[i * 2] << 4) + response[i * 2 + 1];
    }
    this.pifRam.u8[0x2e] = 0;
    this.pifRam.u8[0x2f] = 0;
  }

  configure() {
    for (let chan of this.channels) {
      chan.init();
    }

    let offset = 0;
    let channel = 0;
    while (offset < kPIFRamSize && channel < kNumChannels) {
      const frame = this.pifRam.u8.subarray(offset);
      const txRaw = frame[0];
      offset++;

      // Joybus interpreset certain tx sizes in a special way.
      if (txRaw == kJoybusTxFormatEnd) { break; }
      if (txRaw == kJoybusTxDummyData) { continue; }
      if (txRaw == kJoybusTxChanSkip) {
        channel++;
        continue;
      }
      if (txRaw == kJoybusTxChanReset) {
        this.channels[channel].reset = true;
        channel++;
        continue;
      }

      // Bail out if we can't read the rx value.
      if (offset >= kPIFRamSize) { break; }
      const rxRaw = frame[1];
      offset++;
      // Handle malformed channel command (tx seems valid but rx is 0xfe).
      if (rxRaw == kJoybusTxFormatEnd) { break; }

      const tx = txRaw & 0x3f;
      const txOff = offset;
      offset += tx;

      const rx = rxRaw & 0x3f;
      const rxOff = offset;
      offset += rx;

      if (offset >= kPIFRamSize) { break; }

      const txBuf = this.pifRam.u8.subarray(txOff, txOff + tx);
      const rxBuf = this.pifRam.u8.subarray(rxOff, rxOff + rx);
      this.channels[channel].joybusConfigure(frame, tx, rx, txBuf, rxBuf);
      channel++;
    }
  }

  execute() {
    for (let chan of this.channels) {
      if (chan.reset) {
        // TODO: implement reset.
        continue;
      }
      if (chan.skip) {
        continue;
      }

      const txRaw = chan.frame[0];
      const rxRaw = chan.frame[1];
      if (txRaw & 0x80) {
        continue;
      }
      if (txRaw & 0x40) {
        // TODO: implement reset.
        continue;
      }

      const tx = txRaw & 0x3f;
      const rx = rxRaw & 0x3f;
      // Perform the command and find out how many bytes were returned.        
      // If an unexpected number of bytes were received, set status bits in rx.
      const rxLen = chan.joybusCommand(tx, rx, chan.txBuf, chan.rxBuf);
      if (rxLen < rx) { chan.frame[1] |= kResponseUnder; }
      if (rxLen > rx) { chan.frame[1] |= kResponseOver; }
    }
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

class Channel {
  constructor() {
    this.init();
  }

  expectTx(cmdName, txGot, txExpect) {
    if (txGot != txExpect) {
      logger.log(`${cmdName}: got tx ${txGot} but expect ${txExpect}`)
    }
  }

  init() {
    this.frame = 0;
    this.tx = 0;
    this.rx = 0;
    this.txBuf = null;
    this.rxBuf = null;
    this.skip = true;
    this.reset = false;
  }

  joybusConfigure(frame, tx, rx, txBuf, rxBuf) {
    this.frame = frame;
    this.tx = tx;
    this.rx = rx;
    this.txBuf = txBuf;
    this.rxBuf = rxBuf;
    this.skip = false;
  }
}

class ControllerChannel extends Channel {
  /**
   * Construct a new ControllerChannel instance.
   * @param {ControllerInputs} inputs An instance of ControllerInputs.
   */
  constructor(inputs) {
    super();
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

  getStatus(tx, rx, txBuf, rxBuf) {
    this.expectTx('kCmdGetStatus', tx, 1);

    // Device ID.
    rxBuf[0] = kDeviceIDController >>> 8;
    rxBuf[1] = kDeviceIDController & 0xff;
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

class CartridgeChannel extends Channel {
  constructor(hardware) {
    super();
    this.hardware = hardware;
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

  getEepromID() {
    switch (this.hardware.saveType) {
      case 'Eeprom4k':
        return kDeviceIDEeprom4K;
      case 'Eeprom16k':
        return kDeviceIDEeprom16K;
    }
    return 0;
  }

  getEeprom() {
    switch (this.hardware.saveType) {
      case 'Eeprom4k':
      case 'Eeprom16k':
        return this.hardware.saveMem;
    }
    return null;
  }

  getStatus(tx, rx, txBuf, rxBuf) {
    this.expectTx('kCmdGetStatus', tx, 1);

    const id = this.getEepromID();
    if (!id) {
      return 0;
    }

    // Device ID.
    rxBuf[0] = id >>> 8;
    rxBuf[1] = id & 0xff;
    // Status.
    rxBuf[2] = 0x00;
    return 3;
  }

  readEeprom(tx, rx, txBuf, rxBuf) {
    this.expectTx('kCmdEepromRead', tx, 2);

    // TODO: In a 512 byte EEPROM, the top two bits of block number are ignored: blocks 64-255 are repeats of the first 64

    const eeprom = this.getEeprom();
    if (!eeprom) {
      return 0;
    }

    const offset = txBuf[1] * 8;
    for (let i = 0; i < rx; ++i) {
      rxBuf[i] = eeprom.u8[offset + i];
    }
    return rx;
  }

  writeEeprom(tx, rx, txBuf, rxBuf) {
    this.expectTx('kCmdEepromWrite', tx, 10);

    const eeprom = this.getEeprom();
    if (!eeprom) {
      return 0;
    }
  
    const offset = txBuf[1] * 8;
    for (let i = 0; i < tx - 2; ++i) {
      eeprom.u8[offset + i] = txBuf[2 + i];
    }
    this.hardware.saveDirty = true;

    // Response byte. Could send 0x80 if busy.
    rxBuf[0] = 0;
    return 1;
  }

  rtcStatus(tx, rx, txBuf, rxBuf) {
    // Device ID.
    rxBuf[0] = kDeviceIDRTC >>> 8;
    rxBuf[1] = kDeviceIDRTC & 0xff;
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