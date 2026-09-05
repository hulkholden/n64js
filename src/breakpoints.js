
const kOpBreakpoint = 28;
const kBreakpointInstruction = kOpBreakpoint << 26;

export class Breakpoints {
  constructor(hardware, invalidateCode = () => {}) {
    this.hardware = hardware;
    this.invalidateCode = invalidateCode;
    this.breakpoints = new Map();     // address -> original op
  }

  reset() {
    this.breakpoints.clear();
  }

  toggle(address) {
    address >>>= 0;
    const origInstr = this.hardware.memMap.readMemoryInternal32(address);

    let newInstr;
    if (this.breakpoints.has(address)) {
      // breakpoint is already set
      newInstr = this.breakpoints.get(address);
      this.breakpoints.delete(address);
    } else {
      newInstr = kBreakpointInstruction;
      this.breakpoints.set(address, origInstr);
    }

    this.hardware.memMap.writeMemoryInternal32(address, newInstr);
    this.invalidateCode(address);
  }

  isBreakpoint(address) {
    return this.breakpoints.has(address >>> 0);
  }

  getInstruction(address) {
    address >>>= 0;
    if (this.breakpoints.has(address)) {
      return this.breakpoints.get(address);
    }
    const instr = this.hardware.memMap.readMemoryInternal32(address);
    return instr;
  }
}
