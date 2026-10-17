# n64js

n64js is a Nintendo 64 emulator written in modern JavaScript that runs directly in your browser. It runs many ROMs at full framerate.

## Why?

Mostly for the challenge. I've spent ~25 years (on and off) working on N64 emulators and writing one in JavaScript gives me the opportunity to expand my comfort zone and learn something new. It's a good showcase for how powerful modern browsers have become.

## How To Run

A hosted version is available on GitHub Pages at https://hulkholden.github.io/n64js/.

Click **Load** in the toolbar and choose a local N64 ROM file (`.z64`, `.v64`, or `.n64`). ROMs and save data stay locally in your browser.

## Controls

n64js supports both the keyboard and standard gamepads (via the browser's Gamepad API).

| N64 Input | Keyboard | Standard Gamepad |
| --- | --- | --- |
| **Analog Stick** | Arrow keys | Left Stick |
| **Start** | `A` | Start |
| **A** | `S` | Bottom face button (A / Cross) |
| **B** | `X` | Right face button (B / Circle) |
| **Z** | `Z` or `Y` | Right Trigger (R2 / RT) |
| **L / R** | `C` / `V` | Left / Right Bumper (L1 / R1) |
| **D-Pad** | `T` / `F` / `G` / `H` | D-Pad |
| **C-Buttons** | `I` / `J` / `K` / `L` | Hold Left Trigger (L2 / LT) + face buttons |

## Graphics and Display Options

Display settings are available in the floating options panel under **Graphics**:

* **Internal Render Scale** defaults to **1×**, using the VI source resolution (often 320×240). Increase it (up to **4×**) for higher-resolution 3D geometry.
* **Canvas Scale** controls the output display resolution independently of internal rendering. The final presentation pass upscales the frame and applies CRT effects at the canvas resolution. Use 1× internal rendering for a native-pixel CRT look; 2× gives 640×480 rendering for a 320×240 game. Progressive CPU framebuffers also upload native pixels; interlaced CPU video retains field weaving.
* **CRT** offers **Off** (default), **Simple**, or **Mattias** effects applied to the finished frame. Mattias adds colour separation, spatial ghosting, adjustable curvature, and animated scanlines that pause with emulation.

The Mattias style follows [MattiasCRT by Mattias Gustavsson](https://www.shadertoy.com/view/Ms23DR).
Its implementation is adapted from his [MIT-licensed crtemu_pc.h](https://github.com/mattiasgustavsson/crtview/blob/de7897958ac1f346ca7fa3dbf5a57dab5fcc5bb3/source/crtemu_pc.h).
The attribution and full MIT notice are retained in [crt_mattias.glsl](src/hle/graphics/shaders/crt_mattias.glsl), including in the bundled shader source.
This adaptation uses the current frame for ghosting and omits the original library's temporal blur buffers and frame overlay.

## Audio

High-level audio emulation (HLE) is used by default for supported microcodes, derived from captured RSP disassembly and libultra headers:

* **ABI1** variants including Super Mario 64, Tetrisphere, GoldenEye 007, Diddy Kong Racing, and Blast Corps.
* **NAUDIO** variants including Army Men: Air Combat, Banjo-Kazooie, and Donkey Kong 64.
* **NEAD** variants including Mario Kart 64, Star Fox 64, Shindou editions of Super Mario 64 and Wave Race 64, Yoshi's Story, 1080° Snowboarding, Ocarina of Time, Majora's Mask, Pokémon Stadium 2, F-Zero X, and Animal Forest.

Unreviewed microcode identities and command shapes automatically fall back to low-level RSP emulation (LLE). Select **Audio → Emulation Mode → LLE** in the options panel to run all audio tasks on the RSP.

## Compatibility

Compatibility has improved significantly across CPU, graphics, audio, and timing. Over 95% of [n64-systemtest](https://github.com/lemmy-64/n64-systemtest) tests pass.

The main areas where system tests or games still run into limitations are:

* **Graphics**: Graphics are primarily rendered using WebGL high-level emulation (with experimental LLE RDP support). Many games are playable, though some microcodes (such as Factor 5's custom microcodes) or hardware-specific framebuffer effects still have unimplemented features or visual glitches.
* **Cycle timing**: Instruction timing is still an approximation rather than cycle-accurate, which can affect timing-sensitive games.
* **Edge-case CPU/FPU behaviour**: Some 64-bit addressing edge cases and floating-point rounding near numerical limits are not fully emulated.

## Performance

With dynamic CPU recompilation and HLE graphics/audio, most games run at full framerate on modern desktop hardware (tested primarily on Apple Silicon Macs). Games that fall back to LLE audio or experimental LLE graphics require significantly more CPU/GPU work.

## Browser Compatibility

Saving and loading require native `Uint8Array.prototype.toBase64()` and `Uint8Array.fromBase64()` support: Chrome/Edge 140+, Firefox 133+, or Safari 18.2+ (including iOS). See [browser compatibility](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array/toBase64#browser_compatibility). WebGL is also required.

Chrome is the preferred browser and typically offers the best performance.

## Implementation Status

* [ ] CPU
  * [x] Interpreter & dynamic recompiler (JIT)
  * [x] COP0 instructions
  * [x] COP1 (FPU) instructions
  * [x] TLB
  * [ ] Cycle accuracy
* [x] RSP
* [ ] Controller
  * [x] Static key bindings
  * [ ] Configurable bindings
  * [x] Gamepad API
* [ ] Graphics
  * [x] HLE (GBI0, GBI1, GBI2, S2DEX, L3DEX, Turbo3D, T3DUX, ZSortp)
  * [ ] LLE (experimental RDP support)
* [x] Audio
  * [x] HLE (supported ABI1, NAUDIO, and NEAD microcodes)
  * [x] LLE
* [ ] Save
  * [x] Persistence (via `localStorage`)
  * [ ] Import/Export
  * [x] MemPack (Controller Pak)
  * [x] EEPROM 4K & 16K
  * [x] SRAM
  * [x] FlashRAM

## TODOs

Here are some things I'd like to get around to:

* Continue fixing graphics issues and expanding microcode coverage
* Configurable controller bindings
* Save game import/export
* Savestates

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for instructions on building locally, running tests and headless scripts, querying ROM inventories, CI workflows, and publishing. See [BENCHMARKS.md](BENCHMARKS.md) for benchmarking and profiling instructions.

## History

n64js is derived from [Daedalus](https://github.com/hulkholden/daedalus), an emulator I started working on around 1999 and continued working on periodically for many years.
Around 2012 I made a bet with [@mmalex](https://github.com/mmalex) that I could write a port in JavaScript, and n64js was born!
