# Original Sprite2D microcode

Issue: https://github.com/hulkholden/n64js/issues/377

The original Nintendo Sprite2D program advertises `RSP SW Version: 2.0H,
02-12-97`, also used by Fast3D. It has a 24-byte sprite descriptor at opcode
`0x09`, `ScaleFlip` at `0xBE`, and `Draw` at `0xBD`. The former GBI0 fallback
warned on Base, treated ScaleFlip as CullDL, and treated Draw as PopMatrix.
This discarded sprites and also produced misleading clip warnings.

## Identification

The existing 1,488-byte code-prefix hash identifies two captured builds:

| Prefix hash | Captured from |
| --- | --- |
| `0xaed514f8` | Hiryuu no Ken Twin (Japan) |
| `0x6abfc6f8` | Flying Dragon (USA), Midway's Greatest Arcade Hits - Volume 1 (USA) |

These prefixes include the dispatcher and sprite-specific palette/scaling code.
The advertised 4 KiB code range extends beyond the program into adjacent data:
Flying Dragon and Midway have different full hashes (`0x3794043d` and
`0x2b413a55`) but the same prefix and command semantics. Do not infer Sprite2D
from the version string alone. Ordinary Fast3D retains its CullDL and PopMatrix
handlers. Other unidentified builds still warn instead of interpreting arbitrary
GBI0 commands as sprites.

## Command and pixel fixtures

`tools/sprite2d_cases.js` contains 28 synthetic input descriptions and the RDP
packets emitted by **both** captured programs. The packets matched between the
two builds. ROM code, texture assets and game display lists are not included.

The capture used a fresh RSP instance with the task's boot code and microcode
loaded from the user's ROM, replaced its display list and sprite descriptor with
`sprite2DCommands`/`writeSprite2DFixture` inputs, and ran the RSP until BREAK.
SP DMA completed synchronously with CPU execution stopped. RDP command words
were collected at the DPC output boundary. Image, palette, framebuffer and
sprite addresses were relocated to the fixture's synthetic RAM addresses.

The unit tests compare every draw's coordinates, modes, tile registers and all
4 KiB of TMEM with a replay of those captured packets. The WebGL tests compare
all pixels against the same RDP packet replay and reject empty references.
Cases cover CI4/CI8 palettes, RGBA16/RGBA32/I8, flips, scaling, fractional and
negative screen positions, source offsets, copy mode and multiple TMEM strips.

The implementation retains the RSP reciprocal refinement and fixed-point strip
rounding, including extra filter rows and vertical flips. Invalid descriptors,
nonpositive dimensions/scales and out-of-RAM texture/palette reads are bounded;
one bad sprite cannot consume the following display-list commands. Fractional
sprite positions also exercise signed RDP rectangle S/T coordinates.

```sh
bun test
bun run lint
bun run test:visual --output /tmp/sprite2d-visual
```

Acquire the shared `/tmp/perf.lock` advisory lock before timing-sensitive ROM
replays, and hold it until child processes exit, as described in AGENTS.md.

## Focused ROM validation

Fresh seed-2 replays on base `ca50e05f892896b48ebb40197d3daaa86d9f658d` plus
this change used HLE graphics/audio, null rendering, random-controller v1,
1,800 VI retraces and a 5-billion-cycle ceiling:

| ROM | Sprite Draw commands | HLE warnings |
| --- | ---: | ---: |
| Hiryuu no Ken Twin (Japan) | 714,712 | 0 |
| Flying Dragon (USA) | 246,720 | 0 |
| Midway's Greatest Arcade Hits - Volume 1 (USA) | 368,414 | 0 |

A prototype observer counted Draw and warnings before console deduplication.
These are new focused runs, not revisions of the issue's pinned inventories.
Completing the frame budget is not a full gameplay validation. Matching
640×480 Chromium/SwiftShader captures at VI 60 show restored controller text in
Hiryuu and the publisher logo in Flying Dragon, compared with a clean build of
the base revision. Both captures used the same seed and CRT disabled.

The remaining images/seeds in #377 and the separate Super Robot Spirits coverage
issue #438 still need their own verification; this change does not claim those
coverage findings are fixed.
