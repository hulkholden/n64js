// Offline RSP oracle. Only the original guest program executes here; there is
// no external audio implementation. DMA is synchronous and bounded.
import '../../src/headless/headless_env.js';
import { MemoryRegion } from '../../src/memory/memory_region.js';
import { initRSP, RSP } from '../../src/rsp/rsp.js';

export function createReplay({ ram, dmem, imem }) {
  const sp = new MemoryRegion(new ArrayBuffer(8192));
  sp.u8.set(dmem);
  sp.u8.set(imem, 4096);
  let memAddress = 0, ramAddress = 0;
  const writes = [];
  const hardware = {
    sp_mem: sp,
    sp_ibist_mem: new MemoryRegion(new ArrayBuffer(8)),
    dpcDevice: { readRegU32: () => 0 },
    spRegDevice: {
      readRegU32: () => 0,
      setStatusBits() {},
      writeReg32(reg, value) {
        if (reg === 0) memAddress = value & 0x1ff8;
        else if (reg === 4) ramAddress = value & 0xfffff8;
        else if (reg === 8 || reg === 12) {
          const size = ((value & 4095) | 7) + 1;
          if (value >>> 12) throw new Error('Replay does not support strided DMA');
          if (ramAddress + size > ram.length) throw new Error('Replay DMA outside RAM');
          if (reg === 12) writes.push({ address: ramAddress, size });
          for (let i = 0; i < size; i++) {
            const p = (memAddress & 4096) | ((memAddress + i) & 4095);
            if (reg === 8) sp.u8[p] = ram[ramAddress + i];
            else ram[ramAddress + i] = sp.u8[p];
          }
        }
      },
    },
  };
  const rsp = hardware.rsp = new RSP(hardware);
  initRSP(hardware);
  rsp.halted = false;
  return { rsp, ram, writes };
}
