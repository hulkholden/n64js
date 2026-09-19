
// EmulatedException interrupts processing of an instruction
// and prevents state (such as memory or registers) being updated.
export class EmulatedException {
  constructor(msg) {
    this.msg = msg;
  }

  toString() {
    return this.msg;
  }
}