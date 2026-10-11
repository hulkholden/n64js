# Conker F3DEX2 dialect

Issue: https://github.com/hulkholden/n64js/issues/358

`GBI2Conker` implements the Conker command dialect separately from ordinary
F3DEX2. Identification alone previously selected generic vertex, light and move
handlers and left opcodes 0x10–0x1f unknown.

## Layout evidence

Command fields and lighting behavior were checked against GLideN64 at
[`a04081ad6a966a9413bea63a55f502e0dc98bb18`](https://github.com/gonetz/GLideN64/tree/a04081ad6a966a9413bea63a55f502e0dc98bb18):

- [`F3DEX2CBFD.cpp`](https://github.com/gonetz/GLideN64/blob/a04081ad6a966a9413bea63a55f502e0dc98bb18/src/uCodes/F3DEX2CBFD.cpp): command dispatch, packed indices, coordinate modifiers and lighting overlay.
- [`gSP.cpp`](https://github.com/gonetz/GLideN64/blob/a04081ad6a966a9413bea63a55f502e0dc98bb18/src/gSP.cpp): `gSPCBFDVertex`, `gSPLightCBFD` and basic/advanced Conker lighting.
- [`GBI.h`](https://github.com/gonetz/GLideN64/blob/a04081ad6a966a9413bea63a55f502e0dc98bb18/src/GBI.h): selectors and point-light geometry bit.

The field layouts were also cross-checked against Glide64mk2's
[`ucode08.h`](https://github.com/mupen64plus/mupen64plus-video-glide64mk2/blob/master/src/Glide64/ucode08.h).
Its older lighting approximation differs; this implementation follows GLideN64's
three-dimensional distance attenuation and explicit lighting-overlay switch.
This is floating-point HLE, not an RSP fixed-point accuracy claim.

| Command | Conker interpretation |
| --- | --- |
| `01` vertex | Count in word 0 bits 12–19; end-exclusive cache index in bits 1–7. Sixteen-byte records retain signed XYZ at 0, flag at 6, signed ST at 8, and RGBA at 12. |
| Vertex normal | Signed X/Y bytes at the normal pointer plus **destination cache index × 2**; signed Z in the flag's low byte. RGB is material color, multiplied by lighting. Alpha is retained until fog. Flag bit 15 bypasses color lighting. |
| `10`–`1f` TRI4 | Twelve five-bit indices span both words and the opcode's low nibble. Triangle 0 is word 0 bits 23–27, 18–22, then bits 15–17 joined with word 1 bits 30–31. The remaining indices descend in five-bit groups from word 0 bit 10 and word 1 bit 25. |
| `DB02` | Non-ambient light count is word 1 / **48**, not /24. |
| `DB10` | Coordinate modifier pairs: signed integer bank at offset 0, unsigned 16-bit fraction bank at 0x10, signed translation bank at 0x20. Fraction writes commit integer + fraction scales. Bit 3 selects duplicate writes that are ignored. |
| `DC…08` | Standard viewport layout. |
| `DC…0a` | Slot = word 0 bits 5–18 / **48**. Slots 0/1 are look-at X/Y; subsequent slots are lights. RGB at 0, signed direction bytes at 8, attenuation byte at 12 /16, signed position halfwords at 32/34/36. |
| `DC…0e` | Set the normal-array pointer; **does not load a force matrix**. |
| `DA`, `D8` | Standard F3DEX2 matrix flags, split signed 16.16 matrix encoding and modelview pops. |
| `DD` | Enable the lighting overlay while retaining matrices, vertices, lights, look-at vectors and coordinate modifiers. No generic microcode replacement. |

The ambient slot is at `numLights`. The last non-ambient slot is directional and
only contributes after `DD`; earlier slots use distance attenuation from modified
clip-space XYZ. In overlay mode, geometry bit 0x00400000 also applies normal/direction
terms to those point lights. Light/look-at directions use the transposed modelview.
Segment, fog, clip-ratio and perspective-normalization words retain shared handling;
ForceMatrix words are ignored by this dialect. Other unsupported selectors warn
instead of falling through to incompatible generic semantics.

Vertex loads validate the 32-slot cache and complete vertex/normal RAM ranges
before writing any cache entries. Light counts, light offsets and DMA source
ranges are bounded. TRI4 batches are bounded even for degenerate triangles and
respect counted display lists, debugger limits, opcode changes and buffer capacity.
The common matrix reader now also respects the supplied RAM DataView's byte offset
and extent, exercised by the Conker fixtures.

TRI4 submits each decoded triple in reverse order to match the existing GBI2
renderer convention. Shared TRI1/TRI2/QUAD reverse the wire indices, and
`GeometryModeGBI2` swaps the front/back cull bits relative to
[`F3DEX2.h`](https://github.com/gonetz/GLideN64/blob/a04081ad6a966a9413bea63a55f502e0dc98bb18/src/uCodes/F3DEX2.h).
Preserving only the wire order in TRI4 therefore culled the opposite faces, leaving
holes in Conker, the N64 logo and the floor. Disassembly retains wire order.
`tools/conker_webgl.js` checks all four packed triangle slots against the inherited
commands using literal packets, both orientations, front/back/no culling, and
batched/debug execution. Run it with `bun run test:visual` (SwiftShader) or
`bun run test:visual --hardware` (the normal GPU backend).

## Reproduce browser validation

Install dependencies with `bun install --frozen-lockfile`. If Chromium is not yet
installed, run `bunx playwright install chromium`. Supply your own big-endian ROM:

```sh
node tools/conker_replay.js --rom /path/to/conker-usa.z64 \
  --frames 600,1800,3600 --output build/conker-usa-neutral
node tools/conker_replay.js --rom /path/to/conker-europe.z64 \
  --frames 600,1800,3600 --output build/conker-europe-neutral
node tools/conker_replay.js --rom /path/to/conker-usa.z64 \
  --input tools/conker_story_input.json \
  --frames 600,1800,3600,4800,6000,7200,8400,9600,10800,12000,13200,14400,15600,16800,18000 \
  --output build/conker-usa-story
```

Each run creates a fresh browser context/save state, uses the real WebGL renderer,
and stops CPU execution at every VI retrace. It disables animation-frame driving
so host frame/audio pacing cannot alter input timing. Graphics/audio are HLE,
internal/canvas scale 1×, CRT Off. Audio correctness is not evaluated. The optional
input file specifies absolute VI transitions with button masks and analog axes;
omitted axes are neutral. The supplied transcript pulses Start/A for 20 VIs at
each listed point; all other input is neutral.

The output includes canvas screenshots and `report.json` with ROM and bundle
SHA-256, source revision/dirty flag, browser/GPU, settings, input transcript,
graphics task/load counts, pre-deduplication warnings, halts and WebGL errors.
Warning-free execution alone is not a pixel-correctness test. No ROM data is saved. The checked-in `conker_validation.json` retains the
observed metadata and counters without images or ROM bytes.
`--bundle /path/to/replay.js` reuses an instrumented build; its embedded version and
bundle hash identify it independently from the replay tool's checkout revision.
To compare an older checkout, copy only the two replay JS files into its `tools/`
directory and build there, or retain its generated bundle before switching revisions.

## October 11, 2026 observations

Fresh baseline: `745a40777490956048c98042e2bc390690f10f7a`, revalidated here rather
than inheriting the earlier inventory snapshot. Updated renderer: that revision
plus this PR's implementation; the observed bundle SHA-256 was
`533ab9620c0bb1d1704d7d1693b4138c0893ddae18b89e3bf3eef77f6a5e3b2e`.
Bun 1.3.14; Chromium 145.0.7632.6; macOS arm64;
ANGLE Metal / Apple M4. Screenshots use the same 1000×850 browser viewport and
native canvas CSS sizing (640×480 capture).

| ROM | Canonical SHA-256 |
| --- | --- |
| USA | `32e6a8b970ec12ac5f782344945aa0c98a193832eefb687529d03bab6948714b` |
| Europe | `8717054d8edcf1bb9fb4607c7ac8fe4d6fb855fe6506f7e5dcba62e414558178` |

- USA baseline, neutral: 678 graphics tasks at VI 1,800, 137,022 Conker warnings
  (packed opcodes and MoveWord). At VI 3,052 it halts while generic lighting reads
  an undefined light's `color`. The VI 1,800 canvas is almost entirely solid red.
- USA updated, same neutral sequence: 678 tasks at VI 1,800; 1,543 at VI 3,600.
  No HLE warnings, halts or WebGL errors. Conker and the N64-logo geometry render
  at VI 1,800; the later character close-up renders beyond the previous halt.
  Matched captures against `d527861` also verify that the TRI4 winding correction
  restores Conker's front faces, the logo surfaces and the floor.
- Europe updated, neutral: 703 tasks at VI 1,800; 1,574 at VI 3,600. No HLE warnings,
  halts or WebGL errors. The introduction advances to the rendered game-selection menu.
- The longer USA transcript reaches VI 18,000 / 8,670 graphics tasks with no HLE
  warnings, halts or WebGL errors, rendering the pub and throne-room cinematics
  along the way. This records cinematic progress, not a complete gameplay test.

Some texture seams remain visible. Credit compositing and lighting have not been
checked against hardware captures. These observations do not establish that every
historical Conker symptom is fixed. The command fixtures and GPU culling checks
cover command and rendering behavior independently of these scenes.
