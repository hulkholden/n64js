// Compatibility workarounds keyed by the existing ROM-header CRC ID (rominfo.id),
// not filename or game title. Set enabled to false to investigate without a hack.
//
// Instruction patches apply once per reset, on first execution at the specified
// KSEG0 RAM address. Use a site reached after IPL3's checksum, and always specify
// the expected original word. These are guest-code workarounds, not timing fixes.
//
// Instruction delays charge extra CPU/event cycles once per reset, after the
// matching instruction executes. They leave guest code intact. Use a nonthrowing
// instruction reached after IPL3; the expected word also guards against bad sites.
// These approximate missing timing costs, not a cache or pipeline timing model.
export const compatibilityHacks = {
  '9276ce297985c571': {
    name: 'NHL Breakaway 98 (Europe)',
    enabled: true,
    issue: 'https://github.com/hulkholden/n64js/issues/110',
    // The first frame measures two adjacent osGetTime calls, then divides by
    // their interval in whole microseconds. Our 29–30 COUNT ticks round to zero.
    // Add 64 CPU cycles (32 ticks) at the second call so the interval is >= 1 us.
    // Subsequent frames do real work between samples and need no extra delay.
    instructionDelays: [
      { address: 0x8000c964, expected: 0x0c00f540, cycles: 64 }, // JAL osGetTime
    ],
  },
  'c3cdfd6dc801e74d': {
    name: 'NHL Breakaway 98 (USA)',
    enabled: true,
    issue: 'https://github.com/hulkholden/n64js/issues/110',
    instructionDelays: [
      { address: 0x8000c924, expected: 0x0c00f530, cycles: 64 }, // JAL osGetTime
    ],
  },
  'cb21468727c13100': {
    name: 'NHL Breakaway 99 (Europe)',
    enabled: true,
    issue: 'https://github.com/hulkholden/n64js/issues/110',
    instructionDelays: [
      { address: 0x8000c9a4, expected: 0x0c00ee60, cycles: 64 }, // JAL osGetTime
    ],
  },
  'd06817444ff2737d': {
    name: 'NHL Breakaway 99 (USA)',
    enabled: true,
    issue: 'https://github.com/hulkholden/n64js/issues/110',
    instructionDelays: [
      { address: 0x8000c964, expected: 0x0c00ee50, cycles: 64 }, // JAL osGetTime
    ],
  },
  'e7dda46ae7f4e2e3': {
    name: 'BattleTanx (USA)',
    enabled: true,
    issue: 'https://github.com/hulkholden/n64js/issues/103',
    // osContInit runs before the VI manager initializes libultra's timer list.
    // Skip its 500 ms startup wait; continue normal controller initialization.
    instructionPatches: [
      { address: 0x80111070, expected: 0x14200031, replacement: 0x10000031 }, // BNE at, zero -> B
    ],
  },
  '47e2a4753d960860': {
    name: 'BattleTanx - Global Assault (USA)',
    enabled: true,
    issue: 'https://github.com/hulkholden/n64js/issues/103',
    // Same startup-order bug. The European revision initializes its timers first
    // and deliberately has no entry here.
    instructionPatches: [
      { address: 0x80103480, expected: 0x14200031, replacement: 0x10000031 }, // BNE at, zero -> B
    ],
  },
  '5991f1c35abcd265': {
    name: 'FIFA 64 (Europe) / FIFA Soccer 64 (USA)',
    enabled: true,
    issue: 'https://github.com/hulkholden/n64js/issues/109',
    // During osContInit's 500 ms wait, VI callbacks increment the counter that
    // FIFA also uses to guard video initialization. It then skips setting the
    // refresh rate, leaving a zero divisor for audio startup. Skip only the wait.
    // Both regional images share this CRC ID and the same instruction address.
    instructionPatches: [
      { address: 0x800d4b00, expected: 0x14200031, replacement: 0x10000031 }, // BNE at, zero -> B
    ],
  },
};
