// Compatibility workarounds keyed by the existing ROM-header CRC ID (rominfo.id),
// not filename or game title. Set enabled to false to investigate without a hack.
//
// Instruction patches form one atomic set per ROM. On first execution at the
// first entry's KSEG0 RAM address, every expected word must match before any
// replacement is written. All sites must be loaded by then; choose a trigger
// reached after IPL3's checksum. A mismatch skips the whole set until reset.
// These are guest-code workarounds, not timing fixes.
//
// Instruction delays charge extra CPU/event cycles once per reset, after the
// matching instruction executes. They leave guest code intact. Use a nonthrowing
// instruction reached after IPL3; the expected word also guards against bad sites.
// If a patch set changes a delayed instruction, its pending fingerprint follows
// the replacement; the delay is still charged only when that site executes.
// These approximate missing timing costs, not a cache or pipeline timing model.
export const compatibilityHacks = {
  '0b15d45cf1c20c47': {
    name: 'Extreme-G XG2 (USA)',
    enabled: true,
    // The foreground and background asset loaders share two DMA buffers. Our
    // approximate CPU timing lets the foreground reach osRecvMesg before its
    // first 1 KiB DMA finishes (the LZSS setup takes ~16.6k cycles; PI needs
    // ~18k). Blocking there schedules the background loader, which overwrites
    // the same buffer and corrupts the foreground asset before the title screen.
    //
    // Poll the completion queue before a pending osRecvMesg, keeping interrupts
    // enabled and the current thread runnable. Preserve the helper's existing
    // no-transfer/already-consumed checks, receive, counter and buffer switch.
    // This is a guest workaround for missing CPU timing costs, not a change to
    // global PI timing or an RDP rendering fix.
    instructionPatches: xg2StreamWaitPatches(0x8005aa98, 0xcdf8, 0x8007cd08, 0x8005a978),
  },
  '85ec851131775a4b': {
    name: 'Extreme-G XG2 (Europe)',
    enabled: true,
    // Same shared-buffer wait as USA, at this revision's stream helper/queue.
    instructionPatches: xg2StreamWaitPatches(0x8005aad8, 0xce38, 0x8007cde8, 0x8005a9b8),
  },
  '819b9b3911ad33d5': {
    name: 'Extreme-G XG2 (Japan)',
    enabled: true,
    instructionPatches: xg2StreamWaitPatches(0x8005ab08, 0xd198, 0x8007ce98, 0x8005a9e8),
  },
  '59825e661dbd98d0': {
    name: 'Pocket Monsters Stadium (Japan)',
    enabled: true,
    issue: 'https://github.com/hulkholden/n64js/issues/380',
    // Startup blocks on a 256-byte PI DMA before the idle thread is ready.
    // Our CPU exhausts the runnable threads before the DMA finishes,
    // dispatches the thread-list sentinel, and loops in the exception handler.
    // After the first osEPiRawStartDma submission, allow its 4,668-cycle DMA
    // to finish. This compensates for missing CPU timing costs once per boot;
    // subsequent DMA calls and the global PI timing model remain unchanged.
    instructionDelays: [
      { address: 0x800576cc, expected: 0x00001025, cycles: 5_000 }, // OR v0, zero, zero
    ],
  },
  '9bbfc5f3e2330f16': {
    name: 'Rayman 2 - The Great Escape (USA)',
    enabled: true,
    issue: 'https://github.com/hulkholden/n64js/issues/205',
    // Instant HLE SP completion can allow two builds of the single display-list
    // buffer in one VI. Its texture-list cache uses the VI-driven counter as a
    // generation, so the second build reuses pointers into overwritten commands.
    // Give each build a new cache generation, leaving the VI counter alone.
    // This is a guest workaround for missing RSP timing, not an ERET correction.
    instructionPatches: [
      { address: 0x8008ea14, expected: 0x8c638c3c, replacement: 0x8c638c40 }, // Load the previous cache generation.
      // AT is already 0x800d0000 from the LUI at 0x8008ea58. Replace the
      // redundant LUI before storing the generation with ADDIU v1,v1,1.
      { address: 0x8008ea6c, expected: 0x3c01800d, replacement: 0x24630001 },
    ],
  },
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

// Relocate the same small stream-helper rewrite for each verified XG2 image.
// Two instructions are freed by toggling the 0/1 buffer index with XORI and
// branching directly to the epilogue when no more data needs prefetching. The
// next-transfer length is cleared before either returning or calling prefetch,
// which sets it to the new transfer length. Those slots hold the queue poll.
function xg2StreamWaitPatches(entry, countOffset, receive, prefetch) {
  const jump = address => 0x08000000 | ((address >>> 2) & 0x03ffffff);
  const jal = address => 0x0c000000 | ((address >>> 2) & 0x03ffffff);
  const loadCount = 0x8e220000 | countOffset;
  const storeCount = 0xae220000 | countOffset;
  const original = [
    0x27a50010, jal(receive), 0x24060001, loadCount, 0x2442ffff, storeCount,
    0x8e030008, 0x8e040014, 0x8e050004, 0x24020001, 0xae00000c, 0x00431023,
    0xae020008, 0x14a00003, 0xae040010, jump(entry + 0x7c), 0xae000014,
    jal(prefetch), 0x02002021,
  ];
  const replacement = [
    0x8c820008, // poll: LW v0, validCount(a0)
    0x1040fffe, // BEQ v0, zero, poll
    0x27a50010, // ADDIU a1, sp, 0x10 (delay slot)
    jal(receive), 0x24060001, loadCount, 0x2442ffff, storeCount,
    0x8e030008, 0x8e040014, 0x8e050004,
    0x38620001, // XORI v0, v1, 1: toggle the double-buffer index.
    0xae00000c, 0xae020008, 0xae040010,
    0x10a00003, // BEQ a1, zero, epilogue
    0xae000014, // Clear next length; prefetch sets it if more data remains.
    jal(prefetch), 0x02002021,
  ];
  return [
    // Keep the zero-outstanding-DMA bypass, retargeted to the buffer switch.
    { address: entry + 0x24, expected: 0x10400008, replacement: 0x1040000a },
    ...original.map((expected, i) => ({ address: entry + 0x30 + i * 4, expected: expected >>> 0, replacement: replacement[i] >>> 0 })),
  ];
}
