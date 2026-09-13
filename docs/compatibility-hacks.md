# ROM compatibility hacks

[The config](../src/compatibility_hacks.js) contains the ROM-specific workarounds;
[the executor](../src/compatibility.js) implements them. Entries use the existing
`rominfo.id` (the ROM-header CRC ID used by `romdb.js`), so file renaming does not
affect selection. Set an entry's `enabled` to `false` to disable that workaround.
Selection is refreshed on CPU reset, including after loading a different ROM.

Currently the config supports `instructionPatches`: an address, expected original
32-bit instruction, and replacement. For example, BattleTanx USA has:

```js
'e7dda46ae7f4e2e3': {
  name: 'BattleTanx (USA)',
  enabled: true,
  issue: 'https://github.com/hulkholden/n64js/issues/103',
  instructionPatches: [
    { address: 0x80111070, expected: 0x14200031, replacement: 0x10000031 },
  ],
},
```

The address must be in directly mapped, cached RAM (`0x80000000`–`0x807fffff`).
The patch is attempted on **first execution** at that address, once per reset.
Loading, checksumming, disassembling or reading the instruction as data does not
apply it. Choose an execution site reached after IPL3 has verified the loaded
program. The executor writes the replacement to RAM and executes it; it never
modifies the ROM image. A mismatched original instruction is left intact, with a
warning, and that patch is not retried until reset.

Patches remain pending at debugger breakpoints. Removing or single-stepping a
breakpoint restores the instruction and lets the usual check run. Each reset
gets an independent pending set; the shared config is never consumed.

The hook runs in the interpreter before it records instructions for recompilation.
The dynarec therefore compiles the replacement and needs no compatibility checks
in generated code. Applying a patch flushes existing fragments once, so compiled
code from another virtual alias of the same RAM cannot retain the old instruction.
Once all patches have been attempted, interpreter map lookups
stop too. There remains a null check in the interpreter. COUNT and event timing
are not adjusted.

## BattleTanx startup workaround

The two US games call `osContInit` before the VI manager initializes libultra's
timer list. Under the current timing model they arrive before 500 ms, and trying
to wait for the remaining time dereferences an uninitialized timer link. See the
[diagnosis](battletanx-startup.md) and [timing investigation](battletanx-boot-timing.md).

| ROM ID | Release | Patch address |
| --- | --- | --- |
| `e7dda46ae7f4e2e3` | BattleTanx USA | `0x80111070` |
| `47e2a4753d960860` | Global Assault USA | `0x80103480` |

Both patches replace `BNE at, zero, +0x31` with `B +0x31`, keeping the branch's
target and delay slot. This bypasses the startup timer wait and continues normal
controller initialization. The patch is reached after IPL3's checksum. European
Global Assault initializes its timers in the other order and has no workaround.
This is a guest-code compatibility workaround, not a correction to cache or
boot timing.

## Validation and reproduction

After rebasing onto `19a0c65` (master), with compatibility hacks enabled, fresh
saves and RNG seed 1, the 30-second headless runs produced:

| Release | Input | Graphics tasks | Audio DMAs | VI retraces | Controller commands | First TLB fault |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| BattleTanx USA | Start/A schedule | 780 | 890 | 1,782 | 3,765 | None |
| Global Assault USA | Start/A schedule | 720 | 889 | 1,781 | 3,347 | None |
| Global Assault Europe | Neutral | 733 | 736 | 1,485 | 3,035 | None |

The US runs match the earlier isolated branch-patch experiment, and the European
run matches the original unmodified baseline. Disabling the hacks reproduces
both original US faults and controller timestamps. No diagnostic time override
was used in these runs. Graphics are counted without rasterization, so these
results demonstrate execution progress, not visual correctness or playability.

```sh
bun src/headless_battletanx.js '/Volumes/Data/Roms/BattleTanx (USA).z64' 30 --input
bun src/headless_battletanx.js '/Volumes/Data/Roms/BattleTanx - Global Assault (USA).z64' 30 --input
bun src/headless_battletanx.js '/Volumes/Data/Roms/BattleTanx - Global Assault (Europe) (En,Fr,De).z64' 30
bun src/headless_battletanx.js '/Volumes/Data/Roms/BattleTanx (USA).z64' 1 --no-compatibility-hacks
```

The headless API also accepts `createHeadlessEmulator(loadedROM,
{ enableCompatibilityHacks: false })`. This setting persists across hardware
resets. Browser execution uses the same CPU and config, with hacks enabled.

The nine new automated tests cover both configured branches, unchanged delay
slots and cycle/event accounting, excluded ROMs, disabling, opcode mismatches,
reset/reload, independent pending sets, debugger stepping, compiled execution,
and invalidation of compiled RAM aliases.
All 367 source tests pass, ESLint passes, and the browser bundle builds.

The full `n64-systemtest.z64` run aborts in an
exception storm before completion. An isolated, unmodified source snapshot of baseline
`19a0c65` produces a byte-for-byte identical log
and the same timeout at 5,000,060,742 cycles. This is a pre-existing system-test
failure, not a passing system-test result.
