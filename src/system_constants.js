export const OS_TV_PAL = 0;
export const OS_TV_NTSC = 1;
export const OS_TV_MPAL = 2;

export const countryUnknown = 0;
export const countryBeta = 0x37; // '7'
export const countryAll = 0x41; // 'A'
export const countryBrazil = 0x42; // 'B'
export const countryChina = 0x43; // 'C'
export const countryGermany = 0x44; // 'D'
export const countryNorthAmerica = 0x45; // 'E'
export const countryFrance = 0x46; // 'F'
export const countryGatewayNTSC = 0x47; // 'G' - https://en.wikipedia.org/wiki/Nintendo_Gateway_System
export const countryHolland = 0x48; // 'H'
export const countryItaly = 0x49; // 'I'
export const countryJapan = 0x4A; // 'J'
export const countryKorea = 0x4B; // 'K'
export const countryGatewayPAL = 0x4C; // 'L' - https://en.wikipedia.org/wiki/Nintendo_Gateway_System
export const countryCanada = 0x4E; // 'N'
export const countryEurope = 0x50; // 'P'
export const countrySpain = 0x53; // 'S'
export const countryAustralia = 0x55; // 'U'
export const countryScandinavia = 0x57; // 'W'
export const countryX_PAL = 0x58; // 'X'
export const countryY_PAL = 0x59; // 'Y'
export const countryZ_PAL = 0x60; // 'Z'

export function tvTypeFromCountry(countryId) {
  switch (countryId) {
    case countryChina: // TODO: confim.
    case countryGermany:
    case countryFrance:
    case countryHolland:
    case countryItaly:
    case countryGatewayPAL:
    case countryEurope:
    case countrySpain:
    case countryAustralia:
    case countryScandinavia:
    case countryX_PAL:
    case countryY_PAL:
    case countryZ_PAL:
      return OS_TV_PAL;

    case countryBrazil:
      return OS_TV_MPAL;

    case countryBeta:
    case countryAll:
    case countryNorthAmerica:
    case countryGatewayNTSC:
    case countryJapan:
    case countryKorea:
    case countryCanada:
      return OS_TV_NTSC;
  }
  return OS_TV_NTSC;
}

// See https://n64brew.dev/wiki/ROM_Header.
export const categoryCodes = new Map([
  ['N', 'Game Pak'],
  ['D', '64DD Disk'],
  ['C', 'Expandable Game: Game Pak Part'],
  ['E', 'Expandable Game: 64DD Disk Part'],
  ['Z', 'Aleck64 Game Pak'],
]);

export function categoryCodeDescriptionFromU8(u8) {
  const code = String.fromCharCode(u8);
  const desc = categoryCodes.get(code);
  if (desc) {
    return desc;
  }
  return `unknown code ${code}`;
}