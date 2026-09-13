# n64js

n64js is an n64 emulator written in (mostly) pure ES6 JavaScript. It runs many roms at full framerate.

## Why?

Mostly for the challenge. I've spent ~25 years (on and off) working on N64 emulators and writing one in JavaScript gives me the opportunity to expand my comfort zone and learn something new. It's a good showcase for how powerful modern browsers have become.

## How To Run

A hosted version is available on GitHub pages at https://hulkholden.github.io/n64js/.

## Development

Install `bun`: https://bun.sh/.

Install dependencies from the repository root:

```
bun install
```

Compile sources (add `--watch` to automatically recompile on any change):

```
bun run build
```

The generated `build/` directory is ignored by Git. Build locally before running
the site; CI checks that pull requests and pushes to `master` pass linting and build
successfully.

Run ESLint (using Bun) or apply its automatic fixes:

```
bun run lint
bun run lint:fix
```

Linting covers `src/`, including tests and benchmarks, `tools/`, and the ESLint
config. It uses ESLint's recommended rules and fails on warnings as well as errors.
Existing `no-unused-vars` findings are recorded in `eslint-suppressions.json` as
a baseline of counts per file; increases fail CI. Other recommended rules remain
fully enforced. When cleaning up existing unused variables, run
`bun run lint --prune-suppressions` and commit the reduced baseline with the fix.

Run a local webserver in the root directory:

```
python3 -m http.server
```

Navigate to http://localhost:8000/.

### Headless controller input

Bun scripts can set controller input through the live `inputs` array returned by
`createHeadlessEmulator`. For example, from a script in the repository root:

```js
import { createHeadlessEmulator, loadROMFile, runCycles } from './src/headless_env.js';

const emulator = await createHeadlessEmulator(await loadROMFile('path/to/game.z64'));
const controller = emulator.inputs[0];
controller.buttons = 0x1000; // Hold Start.
controller.stick_x = -80;
controller.stick_y = 0;
runCycles(emulator, 10_000_000);
controller.buttons = 0; // Release Start and centre the stick.
controller.stick_x = 0;
runCycles(emulator, 10_000_000);
```

`buttons` is a 16-bit button mask; `stick_x` and `stick_y` are signed 8-bit values.
Update fields on the existing objects rather than replacing array entries. Each
fresh emulator has four independent, neutral input states; only port 0 is
connected by default. Changing input state does not connect another port.

## Publishing

Push a new `v*` tag (for example, `v1.2.3`) to publish that commit to GitHub Pages.
The tagged commit must include the Pages workflow. It installs dependencies using
the pinned Bun version, builds the bundle, and deploys the site files directly as
a Pages artifact. Generated files do not need to be committed, and ordinary
branch pushes do not update the published site.

One-time repository setup when migrating from branch-based Pages publishing:

1. In **Settings > Pages**, set the build and deployment source to **GitHub Actions**.
2. In **Settings > Environments > github-pages**, allow deployment tags matching
   `v*` (the existing `gh-pages` branch rule does not allow tags).

The deployment includes `index.html`, `n64js.css`, `js/`, `roms/`, and the generated
`build/` directory. Each deployment replaces the site at the existing Pages URL.

## Compatibility

Compatibility has improved a lot over the past few months.

As of 2023-09-23 95% of [n64-systemtest](https://github.com/lemmy-64/n64-systemtest) tests now pass. 

The areas where tests are failing are:

* 64-bit memory access (rarely/never used by roms)
* RDP (shouldn't be a problem, as n64js uses HLE)
* Floating point accuracy

The floating point issues are largely edge cases with rounding values close to the numerical limits for 32 bit floats.

Beyond the things n64-systemtest covers, the main compatibility issues I'm aware of are:

* imprecise cycle counting
* graphics

Imprecise cycle counting affects some roms more than others. GoldenEye in particular seems to hang when LLE audio emulation is enabled on the RSP.
I suspect this is due to the CPU running faster than it should be and causing the game to overflow audio buffers.

Graphics are rendered using high-level emulation and there are still a lot of TODOs. Many roms are playable but most have graphical issues of some kind.

## Browser Compatibility

Saving and loading require native `Uint8Array.prototype.toBase64()` and
`Uint8Array.fromBase64()` support: Chrome/Edge 140+, Firefox 133+, or Safari 18.2+
(including iOS). See [browser compatibility](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array/toBase64#browser_compatibility).
Chrome is the preferred development browser.

## Performance

I've been testing on an Apple M2 Max and most roms run at full framerate *most* of the time.
LLE audio emulation seems to be the biggest performance hit. To date I've mostly been focused on compatibility so there are likely a lot of improvements to be made here.

## Implementation Status

* [ ] CPU
  * [x] cop0 instructions
  * [x] cop1 instructions
  * [x] TLB
  * [ ] Cycle accuracy
* [x] RSP
* [ ] Controller
  * [x] Static key bindings
  * [ ] Configurable bindings
  * [ ] Gamepad API
* [ ] Graphics
  * [ ] HLE
    * [ ] GBI0 - mostly implemented
    * [ ] GBI1 - partially implemented
    * [ ] GBI2 - partially implemented
  * [ ] LLE - not implemented
* [ ] Audio
  * [ ] HLE - not implemented
  * [x] LLE - implemented
* [ ] Save
  * [x] Persistence (via localStorage)
  * [ ] Import/Export
  * [x] Mempack
  * [x] Eeprom 4k
  * [x] Eeprom 16k
  * [x] SRAM
  * [x] FlashRAM

## TODOs

Here are some things I'd like to get around to:

* Fix graphics issues
* Save game import/export
* Savestates
* [Gamepad](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API) support.

## History

n64js is derived from [Daedalus](https://github.com/hulkholden/daedalus), an emulator I started working on around 1999 and continued working on periodically for many years.
Around 2012 I made a bet with [@mmalex](https://github.com/mmalex) that I could write a port in JavaScript, and n64js was born!
