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
  '8c6d9311434b2c6f': {
    name: 'Donkey Kong 64 (Europe)',
    enabled: true,
    // The CIC6105 RSP semaphore wait expires before our initial PI DMA ends,
    // so its scatter DMA never leaves the boot word at RDRAM 0x2fe1c0.
    // Skip the resulting startup trap after IPL3's checksum. This is a
    // workaround for incomplete CPU/RSP timing, not a PI timing correction.
    instructionPatches: [
      { address: 0x80000aa4, expected: 0x1462ffff, replacement: 0x00000000 }, // BNE v1, v0, self -> NOP
    ],
  },
  'a7893c05024306a5': {
    name: 'Donkey Kong 64 (Japan)',
    enabled: true,
    // Same CIC6105 boot-word trap as Europe.
    instructionPatches: [
      { address: 0x80000aa4, expected: 0x1462ffff, replacement: 0x00000000 },
    ],
  },
  'bfea58ec69717cad': {
    name: 'Donkey Kong 64 (USA)',
    enabled: true,
    instructionPatches: [
      { address: 0x80000a04, expected: 0x1462ffff, replacement: 0x00000000 },
    ],
  },
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
  'e2f35d53f1899760': {
    name: 'Wave Race 64 Shindou Edition (Japan)',
    enabled: true,
    issue: 'https://github.com/hulkholden/n64js/issues/113',
    // Another thread starts osEepromLongRead while osContInit is still in its
    // 500 ms wait. The EEPROM timer queue is initialized only after that wait,
    // so osRecvMesg dereferences a null thread-list head. Skip only the wait.
    instructionPatches: [
      { address: 0x800cc6c0, expected: 0x14200031, replacement: 0x10000031 }, // BNE at, zero -> B
    ],
  },
  '9dae5305c1e0d8ea': {
    name: 'Xena - Warrior Princess - The Talisman of Fate (USA)',
    enabled: true,
    issue: 'https://github.com/hulkholden/n64js/issues/114',
    // The scheduler initializes its frame pointer on the first VI callback,
    // but a worker can consume it before our first (full-frame-delayed) VI.
    // Wait just over one PAL/NTSC frame after creating the scheduler threads,
    // before starting the producers. This is a startup timing workaround;
    // changing initial VI timing globally exposes other games' startup races.
    instructionDelays: [
      { address: 0x80002934, expected: 0x0c00e852, cycles: 2_000_000 },
    ],
  },
  'c767160aa6463329': {
    name: 'Xena - Warrior Princess - The Talisman of Fate (Europe)',
    enabled: true,
    issue: 'https://github.com/hulkholden/n64js/issues/114',
    instructionDelays: [
      { address: 0x80002990, expected: 0x0c00e8ce, cycles: 2_000_000 },
    ],
  },
};
