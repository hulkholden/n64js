// Compatibility workarounds keyed by the existing ROM-header CRC ID (rominfo.id),
// not filename or game title. Set enabled to false to investigate without a hack.
//
// Instruction patches apply once per reset, on first execution at the specified
// KSEG0 RAM address. Use a site reached after IPL3's checksum, and always specify
// the expected original word. These are guest-code workarounds, not timing fixes.
export const compatibilityHacks = {
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
