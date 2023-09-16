import * as logger from '../logger.js';

// TODO: See if we can split this up and move to gbi0.js etc.
export const kUCode_GBI0 = 0;         // Super Mario 64, Tetrisphere, Demos
export const kUCode_GBI1 = 1;         // Mario Kart, Star Fox
export const kUCode_GBI2 = 2;         // Zelda, and newer games
export const kUCode_GBI1_SDEX = 3;    // Yoshi's Story, Pokemon Puzzle League
export const kUCode_GBI2_SDEX = 4;    // Neon Evangelion, Kirby
export const kUCode_GBI0_WR = 5;      // Wave Racer USA
export const kUCode_GBI0_DKR = 6;     // Diddy Kong Racing, Gemini, and Mickey
export const kUCode_GBI1_LL = 7;      // Last Legion, Toukon, Toukon 2
export const kUCode_GBI0_SE = 8;      // Shadows of the Empire (SOTE)
export const kUCode_GBI0_GE = 9;      // Golden Eye
export const kUCode_GBI2_CONKER = 10; // Conker BFD
export const kUCode_GBI0_PD = 11;     // Perfect Dark

const ucodeOverrides = new Map([
  [0x60256efc, kUCode_GBI2_CONKER],	// "RSP Gfx ucode F3DEXBG.NoN fifo 2.08  Yoshitaka Yasumoto 1999 Nintendo.", "Conker's Bad Fur Day"
  [0x6d8bec3e, kUCode_GBI1_LL],	    // "Dark Rift"
  [0x0c10181a, kUCode_GBI0_DKR],	  // "Diddy Kong Racing (v1.0)"
  [0x713311dc, kUCode_GBI0_DKR],	  // "Diddy Kong Racing (v1.1)"
  [0x23f92542, kUCode_GBI0_GE],	    // "RSP SW Version: 2.0G, 09-30-96", "GoldenEye 007"
  [0x169dcc9d, kUCode_GBI0_DKR],	  // "Jet Force Gemini"											
  [0x26da8a4c, kUCode_GBI1_LL],	    // "Last Legion UX"				
  [0xcac47dc4, kUCode_GBI0_PD],	    // "Perfect Dark (v1.1)"
  [0x6cbb521d, kUCode_GBI0_SE],	    // "RSP SW Version: 2.0D, 04-01-96", "Star Wars - Shadows of the Empire (v1.0)"
  [0xdd560323, kUCode_GBI1_LL],	    // "Toukon Road - Brave Spirits"				
  [0x64cc729d, kUCode_GBI0_WR],	    // "RSP SW Version: 2.0D, 04-01-96", "Wave Race 64"
  [0xd73a12c4, kUCode_GBI0],        // Fish demo
  [0x313f038b, kUCode_GBI0],        // Pilotwings
]);

export function detect(task) {
  const str = task.detectVersionString();
  const hash = task.computeMicrocodeHash();
  let ucode = ucodeOverrides.get(hash);
  if (ucode === undefined) {
    ucode = inferUcodeFromString(str)
  }

  logMicrocode(str, ucode);
  return ucode;
}

const loggedMicrocodes = new Map();

function logMicrocode(str, ucode) {
  if (loggedMicrocodes.get(str)) {
    return;
  }
  loggedMicrocodes.set(str, true);
  logger.log(`New RSP graphics ucode seen: ${str} = ucode ${ucode}`);
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
    if (str.indexOf('fifo', index) >= 0 || str.indexOf('xbux', index) >= 0) {
      return (str.indexOf('S2DEX') >= 0) ? kUCode_GBI2_SDEX : kUCode_GBI2;
    }
    return (str.indexOf('S2DEX') >= 0) ? kUCode_GBI1_SDEX : kUCode_GBI1;
  }
  // Assume this is GBI0 unless we get a better match.
  return kUCode_GBI0;
}