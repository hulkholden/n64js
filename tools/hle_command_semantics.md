# HLE command semantics (#361)

## Depth branches

The low 12 bits of the branch command encode twice the cached vertex index;
RDPHalf1 supplies the segmented target. A taken branch replaces the current list
without pushing a return address. The existing display-list command budget and
address checks remain in force.

F3DEX1 uses a signed subtraction followed by BGTZ, so equality takes the branch.
F3DEX2 uses BGEZ, so equality continues. Preserve 32-bit subtraction wraparound.
F3DZEX compares the signed integer clip W instead. Other variants compare cached
viewport Z in 16.16 units, including changes made by ZSCREEN. Later viewport
changes must not reinterpret already loaded vertices.

Evidence: the F3DEX1 handler in San Francisco Rush (USA), and the
[F3DEX2 disassembly, G_BRANCH_WZ_handler](https://github.com/Mr-Wiseguy/f3dex2/blob/master/f3dex2.s).
The [SDK BranchLessZ reference](https://ultra64.ca/files/documentation/online-manuals/functions_reference_manual_2.0i/gsp/gSPBranchLessZ.html)
describes the coordinate space. HLE still computes projection in floating point;
this change does not make the RSP reciprocal or vertex pipeline bit-exact.

## Matrix insertion

The 64-byte combined matrix contains 16 signed integer halfwords followed by
16 unsigned fractional halfwords. Each aligned MoveWord updates two elements,
retains their other halves, and transposes the N64 layout into Matrix4x4 storage.
It changes future vertex loads without modifying either matrix stack or cached
vertices. Stack changes invalidate the combined matrix as before.

F3DEX1 first materializes a dirty combined matrix. The SDK removed InsertMatrix
from F3DEX2, but its raw MoveWord table still addresses the combined matrix.
A raw GBI2 write neither multiplies dirty stacks nor changes the matrix-valid
flag; a subsequent vertex load can therefore overwrite it. FORCEMTX explicitly
sets that flag. Tests cover both states.

Evidence: [SDK InsertMatrix reference](https://ultra64.ca/files/documentation/online-manuals/functions_reference_manual_2.0i/gsp/gSPInsertMatrix.html),
[SDK command macros](https://github.com/decompals/ultralib/blob/main/include/PR/gbi.h),
and the F3DEX2 `G_MOVEWORD_handler` / `moveword_table` in the disassembly above.
No matrix insertion was observed in the four targeted game replays below;
its coverage is synthetic command and rendered-triangle fixtures.

## S2DEX control and texture status

Four task-local 32-bit words are addressed by byte offsets 0, 4, 8 and 12.
SetStatus writes a word. SelectDL and object texture loads share the comparison
`(status & mask) == flag`, with an unsigned comparison of the complete flag.
A match skips the operation. A mismatch updates the masked status bits and
executes it. Bits outside the mask in the flag force a mismatch.

SelectDL consumes an immediately preceding RDPHalf0, combines the two address
halves, then calls or branches according to the push flag. Both microcode
families retain ordinary RDP texture-rectangle handling. Missing pairs,
unaligned/out-of-range status IDs, unknown texture types and recursive lists
have bounded negative tests. Status and render mode survive in-list microcode
replacement and reset at the next task.

Command & Conquer's all-zero, type-0 texture record has matching status and is
skipped before interpreting its type. It is not a new texture format.

Evidence: [S2DEX command documentation](https://ultra64.ca/files/documentation/online-manuals/man-v5-1/ucode/s2dex/04.htm)
and [gs2dex.h](https://github.com/decompals/ultralib/blob/main/include/PR/gs2dex.h).
SelectDL was not observed in the four replays; encoded call/branch fixtures
exercise both outcomes, nesting, masks and disassembly.

## S2DEX object coordinates

FLIPS/FLIPT reverse sampling while retaining the object's geometry. Rectangle
flips start at the final 10.5 coordinate inside the image, avoiding a repeated
clamped edge texel. BILERP corrects the half-texel origin independently of the
RDP texture-filter setting. SHRINKSIZE_1/2 remove borders, and WIDEN adds 3/8
texel before quarter-pixel quantization. Object and base scales use the RSP's
fixed-point reciprocal and rounding order.

The three historical low render-mode flags (NOTXCLAMP, XLU, ANTIALIAS) produced
identical RDP packets in the two tested microcodes, including tile clamp state.
They are stored but do not override RDP filtering or blending. Other S2DEX
revisions have not been checked for these historical flags. Rotated sprites
continue to use the existing HLE quad renderer, rather than emulating RDP
triangle coverage and interpolators bit-for-bit.

`tools/s2dex_object_cases.js` contains 31 small, synthetic descriptors and their
expected RDP rectangle parameters. The expectations were obtained by running
synthetic lists through the emulator's LLE RSP interpreter with microcode from:

| Game | Microcode | Detector hash |
| --- | --- | --- |
| Nushi Zuri 64 (Japan) | S2DEX 1.07 | 3046993690 |
| Command & Conquer (Europe) | S2DEX xbus 2.06 | 1879741933 |

Both produced identical rectangle packets for every committed case. Cases cover
all individual render flags, combinations, both flips, fractional origins,
scales, base-matrix translation/scaling and copy mode. A 90-degree sprite matrix
also supplies fixed expected corners. Only synthetic parameters and results
are committed; no ROM or microcode bytes are included.

## Validation

- `bun test`: command consumption, state changes, both branch outcomes,
  integer/fraction matrix writes, invalid inputs and execution budgets.
- `bun run test:visual`: full framebuffer comparisons against all captured
  rectangles for both S2DEX families, rotated quadrant sampling, texture
  reload/skip/invalidate pixels, depth-branch/SelectDL colors and inserted-matrix geometry.
- `bun run lint` and `bun run build`.

Targeted game checks use seed 2, random controller input with no prelude, fresh
save state, 1,800 VI frames and a 5-billion-cycle cap, with HLE graphics and the
null renderer. They establish reachability and termination, not game image
accuracy. Runs are serialized under `/tmp/perf.lock`.

| ROM | Canonical SHA-256 | Observed command |
| --- | --- | --- |
| Roadsters (Europe) | `ba3307883fe81ddeb81ed6a51cb1d4cd9d3353c73ca9007c02212c777b572e2e` | GBI2 BranchZ, first VI 363 |
| San Francisco Rush (USA) | `493960054c6749048d9a1f9f01df5f99a8a5983f19e033606ae4b85beffb3841` | GBI1 BranchLessZ, first VI 1172 |
| Nushi Zuri 64 (Japan) | `7f422da0e0b90eb7a518c73897ffd08fd8d6dfc0d50498de01d7f3fb4008b9a9` | 4,788 flipped sprites, first VI 796 |
| Command & Conquer (Europe) | `55ad032b303c0006da8d2efe732af32ea2cd7c1f3d2b2b0bcab3c71201229cb7` | zero texture descriptor, VI 1012 |

All four replays completed 1,800 VI frames before and after the changes, with no
fatal errors or cycle-cap hits. Branch command totals can change because their
targets contain additional commands.

| Replay | Before | After |
| --- | --- | --- |
| Roadsters | 128,532 branches ignored | 23,950 taken; 72,502 not taken |
| San Francisco Rush | 23,080 unconditional branches | 14,989 taken; 8,169 not taken |
| Nushi Zuri 64 | 4,788 swapX/Y warnings | 4,788 flipped draws; no swap warning |
| Command & Conquer | one unknown type-0 texture warning | matching descriptor skipped; no type warning |

Nushi Zuri's 5,919 existing Sprite2DBase warnings remain outside this change.
