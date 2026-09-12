export const MicrocodeId = Object.freeze({
  GBI0: 0,         // Super Mario 64, Tetrisphere, Demos
  GBI1: 1,         // Mario Kart, Star Fox
  GBI2: 2,         // Zelda, and newer games
  GBI1_SDEX: 3,    // Yoshi's Story, Pokemon Puzzle League
  GBI2_SDEX: 4,    // Neon Evangelion, Kirby
  GBI0_WR: 5,      // Wave Racer USA
  GBI0_DKR: 6,     // Diddy Kong Racing, Gemini, and Mickey
  GBI1_LL: 7,      // Last Legion, Toukon, Toukon 2
  GBI0_SE: 8,      // Shadows of the Empire (SOTE)
  GBI0_GE: 9,      // Golden Eye
  GBI2_CONKER: 10, // Conker BFD
  GBI0_PD: 11,     // Perfect Dark
});

const microcodeProfiles = new Map([
  [MicrocodeId.GBI0, { family: 'GBI0', variant: null }],
  [MicrocodeId.GBI1, { family: 'GBI1', variant: null }],
  [MicrocodeId.GBI2, { family: 'GBI2', variant: null }],
  [MicrocodeId.GBI1_SDEX, { family: 'GBI1', variant: 'S2DEX' }],
  [MicrocodeId.GBI2_SDEX, { family: 'GBI2', variant: 'S2DEX' }],
  [MicrocodeId.GBI0_WR, { family: 'GBI0', variant: 'WR' }],
  [MicrocodeId.GBI0_DKR, { family: 'GBI0', variant: 'DKR' }],
  [MicrocodeId.GBI1_LL, { family: 'GBI1', variant: 'LL' }],
  [MicrocodeId.GBI0_SE, { family: 'GBI0', variant: 'SE' }],
  [MicrocodeId.GBI0_GE, { family: 'GBI0', variant: 'GE' }],
  [MicrocodeId.GBI2_CONKER, { family: 'GBI2', variant: 'CONKER' }],
  [MicrocodeId.GBI0_PD, { family: 'GBI0', variant: 'PD' }],
]);

const ucodeOverrides = new Map([
  [0x60256efc, MicrocodeId.GBI2_CONKER], // "RSP Gfx ucode F3DEXBG.NoN fifo 2.08  Yoshitaka Yasumoto 1999 Nintendo.", "Conker's Bad Fur Day"
  [0x6d8bec3e, MicrocodeId.GBI1_LL],     // "Dark Rift"
  [0x0c10181a, MicrocodeId.GBI0_DKR],    // "Diddy Kong Racing (v1.0)"
  [0x713311dc, MicrocodeId.GBI0_DKR],    // "Diddy Kong Racing (v1.1)"
  [0x23f92542, MicrocodeId.GBI0_GE],     // "RSP SW Version: 2.0G, 09-30-96", "GoldenEye 007"
  [0x169dcc9d, MicrocodeId.GBI0_DKR],    // "Jet Force Gemini"
  [0x26da8a4c, MicrocodeId.GBI1_LL],     // "Last Legion UX"
  [0xcac47dc4, MicrocodeId.GBI0_PD],     // "Perfect Dark (v1.1)"
  [0x6cbb521d, MicrocodeId.GBI0_SE],     // "RSP SW Version: 2.0D, 04-01-96", "Star Wars - Shadows of the Empire (v1.0)"
  [0xdd560323, MicrocodeId.GBI1_LL],     // "Toukon Road - Brave Spirits"
  [0x64cc729d, MicrocodeId.GBI0_WR],     // "RSP SW Version: 2.0D, 04-01-96", "Wave Race 64"
  [0xd73a12c4, MicrocodeId.GBI0],       // Fish demo
  [0x313f038b, MicrocodeId.GBI0],       // Pilotwings
]);

/**
 * Identifies the HLE handler without constructing it or producing side effects.
 * Family and variant describe the selected handler; detection='fallback' means
 * GBI0 was assumed, not positively identified. A null variant selects the base
 * family handler. Hash overrides take precedence over version-string inference.
 * @param {string} version The unmodified microcode version string.
 * @param {number} hash The unsigned hash computed by RSPTask.computeMicrocodeHash.
 * @returns {{id: number, family: string, variant: ?string, version: string,
 *   hash: number, detection: 'hash'|'string'|'fallback'}}
 */
export function identifyMicrocode(version, hash) {
  let id = ucodeOverrides.get(hash);
  let detection = 'hash';
  if (id === undefined) {
    id = inferUcodeFromString(version);
    detection = id === undefined ? 'fallback' : 'string';
    id ??= MicrocodeId.GBI0;
  }
  return { id, ...microcodeProfiles.get(id), version, hash, detection };
}

function inferUcodeFromString(str) {
  const prefixes = ['F3', 'L3', 'S2DEX'];
  let index = -1;
  for (let prefix of prefixes) {
    index = str.indexOf(prefix);
    if (index >= 0) {
      break;
    }
  }
  if (index >= 0) {
    // Preserve the existing matching rules, including the "xbux" spelling.
    if (str.indexOf('fifo', index) >= 0 || str.indexOf('xbux', index) >= 0) {
      return (str.indexOf('S2DEX') >= 0) ? MicrocodeId.GBI2_SDEX : MicrocodeId.GBI2;
    }
    return (str.indexOf('S2DEX') >= 0) ? MicrocodeId.GBI1_SDEX : MicrocodeId.GBI1;
  }
  return undefined;
}
