import * as cpu0reg from './cpu0reg.js';
import { calculateIPL3BootState } from './boot_checksum.js';
import { PI_BSD_DOM1_LAT_REG, PI_BSD_DOM1_PWD_REG, PI_BSD_DOM1_PGS_REG, PI_BSD_DOM1_RLS_REG } from './devices/pi.js';
import { SP_STATUS_REG, SP_STATUS_HALT } from './devices/sp.js';
import { OS_TV_NTSC, OS_TV_PAL, OS_TV_MPAL } from './system_constants.js';

// PIF RAM boot words: bit 18 is the CIC version flag, bits 8..15 are the
// seed passed to IPL3, and bits 0..7 seed IPL2's checksum of the boot code.
// See https://github.com/n64dev/cen64/blob/master/si/cic.c#L11-L23.
const cicBootWords = new Map([
  ['6101', 0x00043f3f],
  ['6102', 0x00003f3f],
  ['6103', 0x0000783f],
  ['6105', 0x0000913f],
  ['6106', 0x0000853f],
]);

export function simulateBoot(cpu0, hardware, rominfo) {
  // Both callers reset the hardware and copy IPL3 to DMEM before this call.
  // This simulates a cold cartridge boot; it does not perform CIC verification.
  const bootWord = cicBootWords.get(rominfo.cic) ?? cicBootWords.get('6102');
  const regionVersion = rominfo.tvType === OS_TV_PAL ? 6 : rominfo.tvType === OS_TV_MPAL ? 4 : 0;
  const boot = calculateIPL3BootState(hardware.sp_mem.subRegion(0x40, 0xfc0), bootWord & 0xff);

  // Preserve the existing CP0 snapshot assumptions for registers IPL1/2 do not
  // initialize. Config includes the hardware's read-only clock-ratio bits.
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

  for (let reg = 1; reg < 32; ++reg) cpu0.setRegU64(reg, 0n);
  cpu0.setRegS32Extend(cpu0reg.AT, boot.at);
  cpu0.setRegS32Extend(cpu0reg.V0, boot.v0);
  cpu0.setRegS32Extend(cpu0reg.V1, boot.v0);
  cpu0.setRegS32Extend(cpu0reg.A0, boot.a0);
  cpu0.setRegS32Extend(cpu0reg.A1, boot.a1);
  cpu0.setRegS32Extend(cpu0reg.A2, 0xa4001f0c);
  cpu0.setRegS32Extend(cpu0reg.A3, 0xa4001f08);
  cpu0.setRegS32Extend(cpu0reg.T0, 0xc0); // Checksum acknowledged, PIF RAM clear requested.
  cpu0.setRegS32Extend(cpu0reg.T2, 0x40);
  cpu0.setRegS32Extend(cpu0reg.T3, 0xa4000040);
  cpu0.setRegS32Extend(cpu0reg.T4, boot.t4);
  cpu0.setRegS32Extend(cpu0reg.T5, boot.t5);
  cpu0.setRegS32Extend(cpu0reg.T6, boot.t6);
  cpu0.setRegS32Extend(cpu0reg.T7, boot.t7);
  cpu0.setRegS32Extend(cpu0reg.S3, (bootWord >>> 19) & 1);
  cpu0.setRegS32Extend(cpu0reg.S4, rominfo.tvType);
  cpu0.setRegS32Extend(cpu0reg.S5, (bootWord >>> 17) & 1);
  cpu0.setRegS32Extend(cpu0reg.S6, (bootWord >>> 8) & 0xff);
  cpu0.setRegS32Extend(cpu0reg.S7, ((bootWord >>> 18) & 1) | regionVersion);
  cpu0.setRegS32Extend(cpu0reg.T8, boot.t8);
  cpu0.setRegS32Extend(cpu0reg.T9, boot.t9);
  cpu0.setRegS32Extend(cpu0reg.SP, 0xa4001ff0);
  // PAL and PAL-M insert one instruction to add the regional version bits.
  cpu0.setRegS32Extend(cpu0reg.RA, rominfo.tvType === OS_TV_NTSC ? 0xa4001550 : 0xa4001554);
  cpu0.setMultHiS32Extend(BigInt(boot.hi));
  cpu0.setMultLoS32Extend(BigInt(boot.lo));

  // IPL1/2 leave the RSP halted and VI disabled. PIF RAM is cleared at handoff.
  hardware.sp_reg.set32(SP_STATUS_REG, SP_STATUS_HALT);
  hardware.vi_reg.set32(0x0c, 0x3ff); // VI_INTR, from PIF ROM offset 0x05c.
  hardware.pif_mem.subRegion(0x7c0, 0x40).clear();
  if (hardware.rom) {
    const header = hardware.rom.getU32(0);
    hardware.pi_reg.set32(PI_BSD_DOM1_LAT_REG, header & 0xff);
    hardware.pi_reg.set32(PI_BSD_DOM1_PWD_REG, (header >>> 8) & 0xff);
    hardware.pi_reg.set32(PI_BSD_DOM1_PGS_REG, (header >>> 16) & 0xf);
    hardware.pi_reg.set32(PI_BSD_DOM1_RLS_REG, (header >>> 20) & 3);
  }

  // Start of the relocated IPL2, identical in all three regional variants.
  // CIC x105's IPL3 XORs these words to build an RSP program. In particular,
  // the second word is LW in PAL too, not the CACHE instruction 0xbda807fc.
  // Only the prefix used by IPL3 is reproduced; this is not a full PIF ROM.
  const imem = hardware.sp_mem.subRegion(0x1000, 0x1000);
  const ipl2Prefix = [
    0x3c0dbfc0, 0x8da807fc, 0x25ad07c0, 0x31080080,
    0x5500fffc, 0x3c0dbfc0, 0x8da80024, 0x3c0bb000,
  ];
  for (let i = 0; i < ipl2Prefix.length; ++i) imem.set32(i * 4, ipl2Prefix[i]);

  cpu0.pc = 0xa4000040;
}
