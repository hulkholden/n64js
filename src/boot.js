import * as cpu0_constants from './cpu0_constants.js';

export function simulateBoot(cpu0, rominfo) {
  const country = rominfo.country;
  const cicChip = rominfo.cic;

  function setGPR(reg, hi, lo) {
    cpu0.gprHi[reg] = hi;
    cpu0.gprLo[reg] = lo;
  }

  cpu0.control[cpu0_constants.controlSR] = 0x241000E0;
  cpu0.control[cpu0_constants.controlConfig] = 0x7006E463;
  cpu0.control[cpu0_constants.controlCount] = 0x5000;
  cpu0.control[cpu0_constants.controlCause] = 0x30000000;
  cpu0.control[cpu0_constants.controlPRId] = 0xb22;
  cpu0.control[cpu0_constants.controlContext] = 0x007FFFF0;
  cpu0.control[cpu0_constants.controlEPC] = 0xFFFFFFFF;
  cpu0.control[cpu0_constants.controlBadVAddr] = 0xFFFFFFFF;
  cpu0.control[cpu0_constants.controlErrorEPC] = 0xFFFFFFFF;
  n64js.cop1ControlChanged();

  setGPR(0, 0x00000000, 0x00000000);
  setGPR(6, 0xFFFFFFFF, 0xA4001F0C);
  setGPR(7, 0xFFFFFFFF, 0xA4001F08);
  setGPR(8, 0x00000000, 0x000000C0);
  setGPR(9, 0x00000000, 0x00000000);
  setGPR(10, 0x00000000, 0x00000040);
  setGPR(11, 0xFFFFFFFF, 0xA4000040);
  setGPR(16, 0x00000000, 0x00000000);
  setGPR(17, 0x00000000, 0x00000000);
  setGPR(18, 0x00000000, 0x00000000);
  setGPR(19, 0x00000000, 0x00000000);
  setGPR(21, 0x00000000, 0x00000000);
  setGPR(26, 0x00000000, 0x00000000);
  setGPR(27, 0x00000000, 0x00000000);
  setGPR(28, 0x00000000, 0x00000000);
  setGPR(29, 0xFFFFFFFF, 0xA4001FF0);
  setGPR(30, 0x00000000, 0x00000000);

  switch (country) {
    case 0x44: //Germany
    case 0x46: //french
    case 0x49: //Italian
    case 0x50: //Europe
    case 0x53: //Spanish
    case 0x55: //Australia
    case 0x58: // ????
    case 0x59: // X (PAL)
      switch (cicChip) {
        case '6102':
          setGPR(5, 0xFFFFFFFF, 0xC0F1D859);
          setGPR(14, 0x00000000, 0x2DE108EA);
          setGPR(24, 0x00000000, 0x00000000);
          break;
        case '6103':
          setGPR(5, 0xFFFFFFFF, 0xD4646273);
          setGPR(14, 0x00000000, 0x1AF99984);
          setGPR(24, 0x00000000, 0x00000000);
          break;
        case '6105':
          //*(u32 *)&pIMemBase[0x04] = 0xBDA807FC;
          setGPR(5, 0xFFFFFFFF, 0xDECAAAD1);
          setGPR(14, 0x00000000, 0x0CF85C13);
          setGPR(24, 0x00000000, 0x00000002);
          break;
        case '6106':
          setGPR(5, 0xFFFFFFFF, 0xB04DC903);
          setGPR(14, 0x00000000, 0x1AF99984);
          setGPR(24, 0x00000000, 0x00000002);
          break;
        default:
          break;
      }

      setGPR(20, 0x00000000, 0x00000000);
      setGPR(23, 0x00000000, 0x00000006);
      setGPR(31, 0xFFFFFFFF, 0xA4001554);
      break;
    case 0x37: // 7 (Beta)
    case 0x41: // ????
    case 0x45: //USA
    case 0x4A: //Japan
    default:
      switch (cicChip) {
        case '6102':
          setGPR(5, 0xFFFFFFFF, 0xC95973D5);
          setGPR(14, 0x00000000, 0x2449A366);
          break;
        case '6103':
          setGPR(5, 0xFFFFFFFF, 0x95315A28);
          setGPR(14, 0x00000000, 0x5BACA1DF);
          break;
        case '6105':
          //*(u32  *)&pIMemBase[0x04] = 0x8DA807FC;
          setGPR(5, 0x00000000, 0x5493FB9A);
          setGPR(14, 0xFFFFFFFF, 0xC2C20384);
          break;
        case '6106':
          setGPR(5, 0xFFFFFFFF, 0xE067221F);
          setGPR(14, 0x00000000, 0x5CD2B70F);
          break;
        default:
          break;
      }
      setGPR(20, 0x00000000, 0x00000001);
      setGPR(23, 0x00000000, 0x00000000);
      setGPR(24, 0x00000000, 0x00000003);
      setGPR(31, 0xFFFFFFFF, 0xA4001550);
  }


  switch (cicChip) {
    case '6101':
      setGPR(22, 0x00000000, 0x0000003F);
      break;
    case '6102':
      setGPR(1, 0x00000000, 0x00000001);
      setGPR(2, 0x00000000, 0x0EBDA536);
      setGPR(3, 0x00000000, 0x0EBDA536);
      setGPR(4, 0x00000000, 0x0000A536);
      setGPR(12, 0xFFFFFFFF, 0xED10D0B3);
      setGPR(13, 0x00000000, 0x1402A4CC);
      setGPR(15, 0x00000000, 0x3103E121);
      setGPR(22, 0x00000000, 0x0000003F);
      setGPR(25, 0xFFFFFFFF, 0x9DEBB54F);
      break;
    case '6103':
      setGPR(1, 0x00000000, 0x00000001);
      setGPR(2, 0x00000000, 0x49A5EE96);
      setGPR(3, 0x00000000, 0x49A5EE96);
      setGPR(4, 0x00000000, 0x0000EE96);
      setGPR(12, 0xFFFFFFFF, 0xCE9DFBF7);
      setGPR(13, 0xFFFFFFFF, 0xCE9DFBF7);
      setGPR(15, 0x00000000, 0x18B63D28);
      setGPR(22, 0x00000000, 0x00000078);
      setGPR(25, 0xFFFFFFFF, 0x825B21C9);
      break;
    case '6105':
      //*(u32  *)&pIMemBase[0x00] = 0x3C0DBFC0;
      //*(u32  *)&pIMemBase[0x08] = 0x25AD07C0;
      //*(u32  *)&pIMemBase[0x0C] = 0x31080080;
      //*(u32  *)&pIMemBase[0x10] = 0x5500FFFC;
      //*(u32  *)&pIMemBase[0x14] = 0x3C0DBFC0;
      //*(u32  *)&pIMemBase[0x18] = 0x8DA80024;
      //*(u32  *)&pIMemBase[0x1C] = 0x3C0BB000;
      setGPR(1, 0x00000000, 0x00000000);
      setGPR(2, 0xFFFFFFFF, 0xF58B0FBF);
      setGPR(3, 0xFFFFFFFF, 0xF58B0FBF);
      setGPR(4, 0x00000000, 0x00000FBF);
      setGPR(12, 0xFFFFFFFF, 0x9651F81E);
      setGPR(13, 0x00000000, 0x2D42AAC5);
      setGPR(15, 0x00000000, 0x56584D60);
      setGPR(22, 0x00000000, 0x00000091);
      setGPR(25, 0xFFFFFFFF, 0xCDCE565F);
      break;
    case '6106':
      setGPR(1, 0x00000000, 0x00000000);
      setGPR(2, 0xFFFFFFFF, 0xA95930A4);
      setGPR(3, 0xFFFFFFFF, 0xA95930A4);
      setGPR(4, 0x00000000, 0x000030A4);
      setGPR(12, 0xFFFFFFFF, 0xBCB59510);
      setGPR(13, 0xFFFFFFFF, 0xBCB59510);
      setGPR(15, 0x00000000, 0x7A3C07F4);
      setGPR(22, 0x00000000, 0x00000085);
      setGPR(25, 0x00000000, 0x465E3F72);
      break;
    default:
      break;
  }

  cpu0.pc = 0xA4000040;
}