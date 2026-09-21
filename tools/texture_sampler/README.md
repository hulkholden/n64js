# Texture sampler visual tests

This gallery complements the explicit GPU pixel checks in
`tools/texture_sampler_webgl.js`. It exercises production TMEM loading, decoding,
texture caching, tile state, combiners, shader generation, `texRect`, `texRectRot`
and `flushTris`. Only RAM and the primitives are synthetic. No ROM is needed,
and there is no separate reference sampler in the test.

## Open the gallery

From the repository root:

```sh
bun install
bun run build:visual
python3 -m http.server 8000
```

Open [the gallery](http://localhost:8000/tools/texture_sampler_visual.html).
Each scene shows the live rendering, a checked-in golden PNG and a difference
heatmap. Select native or 2× internal resolution and one of four deterministic
scroll frames. Rebuild and refresh after changing code. “Render again” reruns
the loaded code and reloads the golden files.

Images are enlarged to fit the page with nearest-neighbour CSS scaling. Pixel
comparison uses raw framebuffer readback: native size is 128 × 96 and 2× is
256 × 192, independently of browser zoom, device pixel ratio and CSS size.
The details panel records these separately, along with browser, GPU, WebGL
options, tolerance and baseline capture provenance.

## Automated comparison

Node.js 24 and Bun are used by the runner. Install its pinned browser once:

```sh
bunx playwright install chromium
bun run test:visual
```

The command builds both browser bundles, starts a temporary loopback server,
runs the 58 explicit pixel checks and compares all 36 visual captures. It exits
unsuccessfully on a changed pixel, missing/wrong-size golden, WebGL error or
browser exception. Results go to `build/texture-sampler-results/results.json`;
failures also save `*-actual.png`, `*-golden.png` and `*-difference.png` when
available. `--output path` selects another results directory.

Playwright 1.58.2 pins Chromium and its SwiftShader software backend. CI uses
Ubuntu 24.04 and uploads the results even on failure. A channel difference of
at most 1 byte is tolerated for rounding; **every pixel exceeding that fails**.
The heatmap highlights only those pixels, increasing brightness with the error.
Interpolated scene coordinates are nudged away from exact 1/32-texel boundaries
so backend rounding does not choose opposite filter steps. The explicit
constant-UV pixel checks still cover exact boundaries.
The initial PNGs were captured on macOS arm64 with that same pinned browser and
SwiftShader; platform and exact browser version are in `goldens/manifest.json`.

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
reviewed images and their capture metadata into `tools/texture_sampler/goldens/`,
then rerun the comparison and include those changes in the PR.

The PNGs are regression baselines from a previous emulator run, not proof of
N64 hardware accuracy. Keep the hand-calculated pixel checks as independent
expectations. Adding or changing a scene must include a review of its expected
behaviour; a successful capture alone is not approval of its output.

The initial review checked the four extended edges in clamp mode, reversed
directions under mirroring, continuous menu-strip checker rows, matching
origin/shift panels and matching perspective-mode triangles. All remaining
scenes were inspected for the orientation and filtering described in the gallery.

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

## Add a scene

Add an entry in `scenes.js` with a stable `id`, a short visual expectation and a
`draw(harness, frame)` function. `tile()` loads synthetic RGBA16 data through the
real TMEM loader. Configure addressing, origins and shifts there; use `mode()`
for filtering/combiner state and the renderer's primitive methods for drawing.
An optional `frames` count adds fixed frame identifiers. Both resolutions are
tested automatically. Capture and review the resulting new PNGs.

This suite targets sampling, not full display-list interpretation, RSP vertex
transforms, general LOD, coverage or VI scanout. Repeatable game screenshots can
complement it when those paths matter.
