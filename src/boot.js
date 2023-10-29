import * as cpu0reg from './cpu0reg.js';
import { OS_TV_PAL } from './system_constants.js';

export function simulateBoot(cpu0, hardware, rominfo) {
  // Create a view of IMEM so we can initialise it.
  // TODO: should cache this somewhere.
  const imem = hardware.sp_mem.subRegion(0x1000, 0x1000);

  cpu0.setControlU64(cpu0reg.controlStatus, 0x00000000_34000000n);
  cpu0.setControlU64(cpu0reg.controlConfig, 0x00000000_7006e463n);
  cpu0.setControlU64(cpu0reg.controlCount, 0x00000000_00005000n);
  cpu0.setControlU64(cpu0reg.controlCause, 0x00000000_0000005cn);
  cpu0.setControlU64(cpu0reg.controlPRId, 0x00000000_00000b22n);
  cpu0.setControlU64(cpu0reg.controlContext, 0x00000000_007ffff0n);
  cpu0.setControlU64(cpu0reg.controlEPC, 0xffffffff_ffffffffn);
  cpu0.setControlU64(cpu0reg.controlBadVAddr, 0xffffffff_ffffffffn);
  cpu0.setControlU64(cpu0reg.controlErrorEPC, 0xffffffff_ffffffffn);
  cpu0.cop1ControlChanged();

  const zero = 0x00000000_00000000n;
  cpu0.setRegU64(0, zero);
  cpu0.setRegU64(1, zero);
  cpu0.setRegU64(2, 0xffffffff_d1731be9n);
  cpu0.setRegU64(3, 0xffffffff_d1731be9n);
  cpu0.setRegU64(4, 0x00000000_00001be9n);
  cpu0.setRegU64(5, 0xffffffff_f45231e5n);
  cpu0.setRegU64(6, 0xffffffff_a4001f0cn);
  cpu0.setRegU64(7, 0xffffffff_a4001f08n);
  cpu0.setRegU64(8, 0x00000000_000000c0n);
  cpu0.setRegU64(9, zero);
  cpu0.setRegU64(10, 0x00000000_00000040n);
  cpu0.setRegU64(11, 0xffffffff_a4000040n);
  // 12 - 15
  cpu0.setRegU64(16, zero);
  cpu0.setRegU64(17, zero);
  cpu0.setRegU64(18, zero);
  cpu0.setRegU64(19, zero);
  cpu0.setRegU64(20, BigInt(rominfo.tvType));
  cpu0.setRegU64(21, zero);
  // 22
  cpu0.setRegU64(23, 0x00000000_00000006n);
  cpu0.setRegU64(24, zero);
  cpu0.setRegU64(25, 0xffffffff_d73f2993n);
  cpu0.setRegU64(26, zero);
  cpu0.setRegU64(27, zero);
  cpu0.setRegU64(28, zero);
  cpu0.setRegU64(29, 0xffffffff_a4001ff0n);
  cpu0.setRegU64(30, zero);
  cpu0.setRegU64(31, 0xffffffff_a4001554n);

  if (rominfo.tvType == OS_TV_PAL) {
    switch (rominfo.cic) {
      case '6102':
        cpu0.setRegU64(5, 0xffffffff_c0f1d859n);
        cpu0.setRegU64(14, 0x00000000_2de108ean);
        cpu0.setRegU64(24, zero);
        break;
      case '6103':
        cpu0.setRegU64(5, 0xffffffff_d4646273n);
        cpu0.setRegU64(14, 0x00000000_1af99984n);
        cpu0.setRegU64(24, zero);
        break;
      case '6105':
        cpu0.setRegU64(5, 0xffffffff_decaaad1n);
        cpu0.setRegU64(14, 0x00000000_0cf85c13n);
        cpu0.setRegU64(24, 0x00000000_00000002n);
        break;
      case '6106':
        cpu0.setRegU64(5, 0xffffffff_b04dc903n);
        cpu0.setRegU64(14, 0x00000000_1af99984n);
        cpu0.setRegU64(24, 0x00000000_00000002n);
        break;
      default:
        break;
    }

    cpu0.setRegU64(20, zero);
    cpu0.setRegU64(23, 0x00000000_00000006n);
    cpu0.setRegU64(31, 0xffffffff_a4001554n);
  } else {
    switch (rominfo.cic) {
      case '6102':
        cpu0.setRegU64(5, 0xffffffff_c95973d5n);
        cpu0.setRegU64(14, 0x00000000_2449a366n);
        break;
      case '6103':
        cpu0.setRegU64(5, 0xffffffff_95315a28n);
        cpu0.setRegU64(14, 0x00000000_5baca1dfn);
        break;
      case '6105':
        cpu0.setRegU64(5, 0x00000000_5493fb9an);
        cpu0.setRegU64(14, 0xffffffff_c2c20384n);
        break;
      case '6106':
        cpu0.setRegU64(5, 0xffffffff_e067221fn);
        cpu0.setRegU64(14, 0x00000000_5cd2b70fn);
        break;
      default:
        break;
    }
    cpu0.setRegU64(20, 0x00000000_00000001n);
    cpu0.setRegU64(23, zero);
    cpu0.setRegU64(24, 0x00000000_00000003n);
    cpu0.setRegU64(31, 0xffffffff_a4001550n);
  }

  switch (rominfo.cic) {
    case '6101':
      cpu0.setRegU64(22, 0x00000000_0000003fn);
      break;
    case '6102':
      cpu0.setRegU64(1, 0x00000000_00000001n);
      cpu0.setRegU64(2, 0x00000000_0ebda536n);
      cpu0.setRegU64(3, 0x00000000_0ebda536n);
      cpu0.setRegU64(4, 0x00000000_0000a536n);
      cpu0.setRegU64(12, 0xffffffff_ed10d0b3n);
      cpu0.setRegU64(13, 0x00000000_1402a4ccn);
      cpu0.setRegU64(15, 0x00000000_3103e121n);
      cpu0.setRegU64(22, 0x00000000_0000003fn);
      cpu0.setRegU64(25, 0xffffffff_9debb54fn);
      break;
    case '6103':
      cpu0.setRegU64(1, 0x00000000_00000001n);
      cpu0.setRegU64(2, 0x00000000_49a5ee96n);
      cpu0.setRegU64(3, 0x00000000_49a5ee96n);
      cpu0.setRegU64(4, 0x00000000_0000ee96n);
      cpu0.setRegU64(12, 0xffffffff_ce9dfbf7n);
      cpu0.setRegU64(13, 0xffffffff_ce9dfbf7n);
      cpu0.setRegU64(15, 0x00000000_18b63d28n);
      cpu0.setRegU64(22, 0x00000000_00000078n);
      cpu0.setRegU64(25, 0xffffffff_825b21c9n);
      break;
    case '6105':
      // IPL1 or IPL2 leaves this junk in imem which CIC x105 ends up XORing
      // to decrypt and executing on the RSP during IPL3.
      // See https://github.com/decompals/N64-IPL/blob/d93544681bfa822865fa8110d88f846b52293e23/src/ipl3.s#L63.
      imem.set32(0x00, 0x3c0dbfc0);
      imem.set32(0x04, rominfo.tvType == OS_TV_PAL ? 0xbda807fc : 0x8da807fc);
      imem.set32(0x08, 0x25ad07c0);
      imem.set32(0x0c, 0x31080080);
      imem.set32(0x10, 0x5500fffc);
      imem.set32(0x14, 0x3c0dbfc0);
      imem.set32(0x18, 0x8da80024);
      imem.set32(0x1c, 0x3c0bb000);

      cpu0.setRegU64(1, zero);
      cpu0.setRegU64(2, 0xffffffff_f58b0fbfn);
      cpu0.setRegU64(3, 0xffffffff_f58b0fbfn);
      cpu0.setRegU64(4, 0x00000000_00000fbfn);
      cpu0.setRegU64(12, 0xffffffff_9651f81en);
      cpu0.setRegU64(13, 0x00000000_2d42aac5n);
      cpu0.setRegU64(15, 0x00000000_56584d60n);
      cpu0.setRegU64(22, 0x00000000_00000091n);
      cpu0.setRegU64(25, 0xffffffff_cdce565fn);
      break;
    case '6106':
      cpu0.setRegU64(1, zero);
      cpu0.setRegU64(2, 0xffffffff_a95930a4n);
      cpu0.setRegU64(3, 0xffffffff_a95930a4n);
      cpu0.setRegU64(4, 0x00000000_000030a4n);
      cpu0.setRegU64(12, 0xffffffff_bcb59510n);
      cpu0.setRegU64(13, 0xffffffff_bcb59510n);
      cpu0.setRegU64(15, 0x00000000_7a3c07f4n);
      cpu0.setRegU64(22, 0x00000000_00000085n);
      cpu0.setRegU64(25, 0x00000000_465e3f72n);
      break;
    default:
      break;
  }

  cpu0.pc = 0xA4000040;
}