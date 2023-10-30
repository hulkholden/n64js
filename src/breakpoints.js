
const kOpBreakpoint = 28;

export class Breakpoints {
  constructor(hardware) {
    this.hardware = hardware;
    this.breakpoints = new Map();     // address -> original op
  }

  reset() {
    this.breakpoints.clear();
  }

  toggle(address) {
    const origInstr = this.hardware.memMap.readMemoryInternal32(address);
  
    let newInstr;
    if (isBreakpointInstruction(origInstr)) {
      // breakpoint is already set
      newInstr = this.breakpoints[address] || 0;
      delete this.breakpoints[address];
    } else {
      newInstr = (kOpBreakpoint << 26);
      this.breakpoints[address] = origInstr;
    }
  
    this.hardware.memMap.writeMemoryInternal32(address, newInstr);
  }

  isBreakpoint(address) {
    const instr = this.hardware.memMap.readMemoryInternal32(address);
    return isBreakpointInstruction(instr);
  }

  getInstruction(address) {
    const instr = this.hardware.memMap.readMemoryInternal32(address);
    if (isBreakpointInstruction(instr)) {
      return this.breakpoints[address] || 0;
    }
    return instr;
  }
}

function isBreakpointInstruction(instr) {
  return ((instr >> 26) & 0x3f) === kOpBreakpoint;
}

