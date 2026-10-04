# Battle for Naboo graphics investigation (#296)

Investigated on 2026-10-04 against `e6f56f3c275e2358571e2355f5998dff899d7b4f`
with Bun 1.3.14. The runaway list is a consequence of decoding unsupported
Factor 5 commands as GBI0. The change accompanying this report identifies
`F5/NABOO` and rejects HLE execution before parsing commands. It does not
implement graphics support or establish gameplay correctness.

## Reproduction on the current revision

Fresh saves, HLE graphics with NullRenderer, random-controller v1 / mulberry32,
seed 1, 1,800 VI retraces, 5,000,000,000 cycles, 60,000 ms timeout:

| ROM | Canonical ROM SHA-256 | Result | VI | Cycles | Guard PC | Stack depth |
| --- | --- | --- | ---: | ---: | --- | ---: |
| Europe | `b5bdfe343a2b24cad636b66cac0af54ac04aefbfa26a817957227cc24ced4846` | halted | 273 | 536,051,165 | `0x00685810` | 6,330 |
| USA | `515b2302fefe1741c09103f70708690a058ba77a7ab8acd086c48b972b22d33e` | halted | 306 | 502,258,689 | `0x00685a20` | 6,330 |

These reproduce the issue's seed-1 results exactly. Seeds 2 and 3 were not
repeated before the change. The one-million-command host guard was unchanged.

```sh
bun run inventory '/Volumes/Data/Roms/Star Wars Episode I - Battle for Naboo (Europe).z64' \
  --seed 1 --frames 1800 --max-cycles 5000000000 --timeout-ms 60000 \
  --output /tmp/naboo-eu-before.json
```

Repeat with the USA ROM. A nonzero exit is expected; retain the JSON.

## Task and microcode capture

A temporary diagnostic wrapper around `HeadlessGraphics.processTask` recorded
task pointers and code hashes. A wrapper around `RSPState.nextCommand` retained
the last 400 fetched commands, including words consumed as command parameters.
These wrappers were used in separate seed-1 runs and are not production changes.

| Field | Europe | USA |
| --- | --- | --- |
| Failing graphics task number | 125 | 140 |
| Code pointer / size | `0x0003a8c0` / `0x1000` | same |
| Code data pointer / size | `0x0004e8e0` / `0xec` | same |
| Failing task data pointer | `0x0068d5d0` | `0x0068d2b8` |
| Version string | empty | empty |
| n64js code hash | `0x1f59be1a` (525975066) | same |
| Code SHA-256 | `bbbe1b55970f41ed8a932b645631b18b01611990ded7fd251737fd1dd7376310` | same |

Every captured graphics task in each run used these same 4,096 code bytes.
The first graphics task starts at VI 2 in both regions, with data pointer
`0x00659108`.

The captured code yields CRC32 `0x23fef05f` after reversing bytes within each
32-bit word to match GLideN64's RDRAM representation. Its
[microcode table](https://github.com/gonetz/GLideN64/blob/master/src/GBI.cpp)
maps this CRC to `F5Indi_Naboo` for Battle for Naboo. CRC32 on n64js's canonical
big-endian bytes instead yields `0x5d7bdce3`; comparing that directly to the
GLideN64 table would be incorrect.

## Repeating command sequence

The Europe trace repeats this path every 158 dispatched operations while adding
one persistent stack entry (parameter reads do not advance the operation index):

1. Parent `0x0068d5d8`: `06000000 4004cc20` calls the setup list.
2. Parent `0x0068d5e0`: `06000000 80685800` calls the framebuffer setup list.
3. Parent `0x0068d5e8`: `06000000 8068d0a8` calls the linked rectangle list.
4. The fallback walks through linked-block headers and `b5000000` commands.
5. At `0x0068d548`, `e42481f0 002081b8` starts the final rectangle.
   GBI0 reads both `0x0068d550` (`00000000 04000400`) and `0x0068d558`
   (`b8000000 00000000`) as rectangle parameters. The end-list command is
   therefore consumed without executing its handler.
6. Execution continues through padding into the parent at `0x0068d5d0`,
   then repeats the calls with the previous child return still on the stack.

The USA trace follows the same path at different addresses: parent calls at
`0x0068d2c0`, `0x0068d2c8`, and `0x0068d2d0`; rectangle at `0x0068d230`;
consumed end-list at `0x0068d240`; parent header at `0x0068d2b8`.

The [Factor 5 reference handler](https://github.com/gonetz/GLideN64/blob/master/src/uCodes/F5Indi_Naboo.cpp)
also explains the surrounding data: list blocks begin with link metadata,
`0xb5` follows the saved block link, `0xbc` writes microcode DMEM, and `0xe4`
runs a sublist before issuing an RDP rectangle. GBI0 does not implement these
semantics. Fixing only the final rectangle's word count or raising the command
limit would leave earlier commands incorrectly executed.

## Bounded diagnostic correction

Added a separate `F5_NABOO` identity, using the captured full code hash for both
regions. A separate variant avoids Indiana Jones's existing skip-and-complete
path, which would claim completion without implementing Naboo's commands.
Naboo now raises `UnsupportedMicrocodeError` at task dispatch and in-list
microcode loads. Explicit LLE remains available; it was not evaluated here.

With the change, both regions and seeds 1–3 stop at their first graphics task
at VI 2 with an explicit `F5/NABOO` limitation. No display-list commands are
executed and no HLE completion or DP/SP completion interrupt is fabricated.
Synthetic-code integration tests cover these properties, including execution
with ignored warnings, skipped headless lists, and explicit LLE routing.

Validation: `bun test` passed all 1,982 tests across 101 files; `bun run lint`
and `git diff --check` passed. Post-change run cycles were 27,949,551 for Europe
and 27,324,008 for USA, identical across seeds 1–3 in each region.

Full support needs a Factor 5 handler for linked blocks, DMEM/DMA operations,
sublist rectangle processing, and Naboo geometry generation, or a separately
validated RSP/RDP LLE path. The evidence ties Naboo to `F5Indi_Naboo`; it does
not establish equivalence to Rogue Squadron's protocol.

## Local diagnostic artifacts

The following files were retained under `/tmp` during this investigation:

- `naboo-eu-before.json`, `naboo-us-before.json`: unmodified seed-1 results.
- `naboo-Europe-trace.json`, `naboo-USA-trace.json`: task pointers and command tails.
- `naboo-trace.js`: temporary capture harness (absolute imports for this checkout).
- `naboo-{Europe,USA}-seed{1,2,3}-after.json`: post-change bounded results.

These temporary files may be removed by the operating system. No ROM or
microcode bytes are included in the repository or its tests.
