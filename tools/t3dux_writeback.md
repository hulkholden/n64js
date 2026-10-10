# T3DUX transform-only writeback

Tasks containing an object with `matrixFlag & 4` run on the RSP, including any
ordinary rendering objects in the same task. Other T3DUX tasks continue to use
HLE. This implements guest-visible writeback through the original microcode;
it does not introduce a floating-point HLE approximation of that operation.

The preflight uses the six-word object records and follows global-state segment
updates, including segment zero. It checks before any HLE object executes, so
the RSP sees the original RAM and executes the task's matrix loads, attribute
loads, RDP commands, and writebacks in order. SP task completion and DP FullSync
interrupts come from normal RSP/RDP execution. The direct HLE guard remains as
a safeguard against callers that bypass task dispatch.

## Microcode evidence

The transform/writeback routines at IMEM `0x1540..0x17a0` are identical in the
locally inspected `26da8a4c` (Last Legion UX / Toukon Road 2) and `dd560323`
(Brave Spirits) variants. No microcode binaries are included here.

- Object state is at DMEM `0xe0`: count at `+6`, vertex offset at `+7`, flags
  at `+9`. The matrix starts at `0xf8`; viewport and perspective normalization
  come from global state. Bit 0 keeps the matrix, bit 1 skips transformation.
- `0x1200..0x122c` skips triangle DMA when bit 2 is set. `0x1230..0x1240`
  independently skips the transform routine when bit 1 is set, so flags 6/7
  must not be interpreted as a request to transform and write anyway.
- `0x1554..0x156c` reads eight-byte vertices from `0x140 + (v0 << 3)`.
  `0x15d4..0x16ec` uses RSP split fixed-point matrix arithmetic, perspective
  normalization, the hardware reciprocal sequence, and viewport conversion.
  Saturation/truncation at the vector operations is observable in RAM; host
  floating-point projection followed by integer conversion is not equivalent.
- `0x16f0..0x1740` clamps, adds two, masks the packed high components with
  `0xfffc`, and stores eight-byte vertices. X/Y are signed 10.2 screen
  coordinates; the Z word combines its high component and fractional half.
  Bit 31 is also consumed as the rejection bit by the triangle path.
- **The DMA uses a different stride:** `0x1744..0x177c` selects DMEM
  `0x140 + (v0 << 4)`, the segment-resolved **triangle pointer** from the
  record as the RAM destination, and `(count << 4) - 1` as the write-length
  register. It therefore transfers `count * 16` bytes, including adjacent
  DMEM, rather than only the `count * 8` freshly packed bytes. The normal SP
  DMA implementation supplies alignment, length rounding, and DMEM wrapping.
- `0x1798..0x17a0` skips triangle emission for transform-only objects, but
  their state/RDP commands have already executed. Mixed tasks still emit RDP
  output and must not be skipped wholesale.

Executing the original task preserves these details, including zero counts,
flag combinations, reused DMEM, reciprocal edge cases, and fixed-point
overflow, without duplicating them in an incomplete HLE conversion.

## Validation

On base `a9e70543b081800075bea15f12bc9ac493ab8fe7`, Last Legion UX still halted
at VIs 307, 307, and 481 for seeds 1, 2, and 3. With selective RSP execution,
all three seeds reached 1,800 VIs. Toukon Road 2 and Brave Spirits also reached
1,800 VIs on all three seeds. Settings: Bun 1.3.14, HLE/null renderer, fresh
saves, random-controller v1 / mulberry32, five billion cycles, 60 seconds.
These are bounded compatibility checks, not proof of gameplay correctness.

A local seed-1 DMA trace verified actual RAM changes, not only VI progress:
the first write at VI 307 copied 48 bytes from DMEM `0x140` to RAM `0x2d02f0`.
The first three packed vertices were
`01a801c403209b6a 01a8016c0320ced0 016401bc031078ff`; the remaining 24 bytes
were zero. Subsequent writes at VIs 309 and 311 updated those coordinates.
The ROM's normalized SHA-256 was
`cae4ea984be5b2f81c06a6815f8f20e63a1b7d5b4b089d55caf7cb1a9ed5b427`.

Synthetic tests cover segment changes, later writeback objects, terminators,
truncated input, both variants, DMA contents and boundaries, RDP output,
completion interrupts, graphics-skipping mode, and returning to HLE on the
next ordinary task. They contain no game microcode. The DMA test validates
dispatch and memory effects; fixed-point calculation is delegated to the
existing RSP implementation.

The tradeoff is RSP interpretation cost for mixed tasks containing writeback.
A future HLE implementation must reproduce the packed arithmetic and the
entire DMA source range before replacing this path.
