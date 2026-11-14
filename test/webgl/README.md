# WebGL pixel checks and texture sampler visual tests

`test/webgl/` exercises the production TMEM loader, texture decoder, shaders,
microcodes, render targets and presentation pipeline against a real WebGL2
context, without requiring copyrighted ROMs:

- `test/webgl/pixel_checks.js` runs all `*_webgl.js` pixel-check suites (texture
  sampling, TMEM integer decoding, raw RDP packets, S2DEX backgrounds/objects,
  Sprite2D, L3DEX2, Conker, Turbo3D/T3DUX affine projection, vertex fog,
  F3DFLX reflections, `MoveWord LightCol`/`Points`/`ForceMatrix`, `ModifyVertex`,
  near-plane/primitive depth clipping, scissoring, DP freeze and VI scanout).
- `test/webgl/texture_sampler/` renders synthetic scenes and compares them with
  checked-in golden PNGs across native and 2× resolutions.

The [Texture sampler visuals workflow](../../.github/workflows/texture-sampler.yml)
runs both suites with `bun run test:visual --self-test` on every pull request.

## Open in a browser

From the repository root:

```sh
bun install
bun run build:visual
python3 -m http.server 8000
```

- [Visual comparison gallery](http://localhost:8000/test/webgl/texture_sampler_visual.html):
  each scene shows the live rendering, a checked-in golden PNG and a difference
  heatmap. Select native or 2× internal resolution and one of four deterministic
  scroll frames. Rebuild and refresh after changing code. “Render again” reruns
  the loaded code and reloads the golden files.
- [GPU pixel checks](http://localhost:8000/test/webgl/pixel_checks.html):
  runs all WebGL pixel-check suites automatically and reports their results.
  Append `?suite=<name>` (for example, `?suite=light-color`,
  `?suite=modify-vertex` or `?suite=moveword-points`) to run a single suite.

Gallery images are enlarged to fit the page with nearest-neighbour CSS scaling.
Pixel comparison uses raw framebuffer readback: native size is 128 × 96 and 2×
is 256 × 192, independently of browser zoom, device pixel ratio and CSS size.
The details panel records these separately, along with browser, GPU, WebGL
options, tolerance and baseline capture provenance.

## Automated comparison

Bun runs the Playwright harness directly. Install its pinned browser once:

```sh
bunx playwright install chromium
bun run test:visual
```

The command builds both browser bundles, starts a temporary loopback server,
runs the explicit pixel checks and compares all visual captures. It exits
unsuccessfully on a changed pixel, missing/wrong-size golden, WebGL error or
browser exception. Results go to `build/texture-sampler-results/results.json`;
failures also save `*-actual.png`, `*-golden.png` and `*-difference.png` when
available. `--output path` selects another results directory. In CI, download
the `texture-sampler-visuals` artifact for these files, including the deliberate
regression's images under `self-test/`.

Playwright 1.58.2 pins Chromium and its SwiftShader software backend. CI uses
Ubuntu 24.04 and uploads the results even on failure. A channel difference of
at most 1 byte is tolerated for rounding; **every pixel exceeding that fails**.
The heatmap highlights only those pixels, increasing brightness with the error.
Interpolated scene coordinates are nudged away from exact 1/32-texel boundaries
so backend rounding does not choose opposite filter steps. The explicit
constant-UV pixel checks still cover exact boundaries. The initial PNGs were
captured on macOS arm64 with that same pinned browser and SwiftShader; platform
and exact browser version are in `texture_sampler/goldens/manifest.json`.

To investigate another GPU, use `bun run test:visual --hardware --output
build/texture-sampler-hardware` or open the gallery in your browser. `--hardware`
uses Chromium's default backend, which is recorded in the report; it does not
guarantee hardware acceleration. Backend differences should be investigated,
not silently accepted by raising tolerance or replacing goldens.

## Capture and review goldens

```sh
bun run test:visual --capture
```

This writes PNGs and capture metadata to
`build/texture-sampler-results/candidate/`. It **never updates checked-in goldens**.
Review the candidates against the existing goldens, difference images and
each scene's stated expectation. For intentional changes, copy only the
reviewed images and their capture metadata into `test/webgl/texture_sampler/goldens/`,
then rerun the comparison and include those changes in the PR.

The PNGs are regression baselines from a previous emulator run, not proof of
N64 hardware accuracy. Keep the hand-calculated pixel checks as independent
expectations. Adding or changing a scene must include a review of its expected
behaviour; a successful capture alone is not approval of its output.

## Verify regression detection

```sh
bun run test:visual --self-test
```

After the normal comparisons pass, this changes only the served shader bundle
to remove native rectangle pixel quantization. The 2× adjacent-strip scene must
then differ from its golden. It reproduces the menu-style seam and saves the
actual/golden/difference images under `build/texture-sampler-results/self-test/`.
The command fails if the deliberate regression goes undetected. CI runs this
check too; no production source or golden is modified.

## Fog and F3DFLX blender notes

`test/webgl/fog_webgl.js` covers vertex fog, F3DFLX reflection alpha lighting,
and constant fog-alpha framebuffer modes `0x0110` and `0x3110` in one and two
cycles. Support requires `FORCE_BL` with `AA_EN`, `CLR_ON_CVG`, `CVG_X_ALPHA`
and `ALPHA_CVG_SEL` clear; unsupported combinations retain the opaque fallback.

The forced-blend reference uses `a = fogAlpha >> 3`, then
`(source * a + destination * (32 - a)) >> 5`, as in
[angrylion's blender equations](https://github.com/ata4/angrylion-rdp-plus/blob/master/src/core/n64video/rdp/blender.c).
Consequently alpha 255 retains 1/32 of the destination. WebGL uses the same
weights, but can round the final byte instead of truncating; the one-byte pixel
tolerance covers this HLE approximation.

## Add a visual gallery scene

Add an entry in `test/webgl/texture_sampler/scenes.js` with a stable `id`, a
short visual expectation and a `draw(harness, frame)` function. `tile()` loads
synthetic RGBA16 data through the real TMEM loader. Configure addressing,
origins and shifts there; use `mode()` for filtering/combiner state and the
renderer's primitive methods for drawing. An optional `frames` count adds fixed
frame identifiers. Both resolutions are tested automatically. Capture and review
the resulting new PNGs.
