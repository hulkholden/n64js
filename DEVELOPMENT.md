# Development

Install `bun`: https://bun.sh/.

Install dependencies from the repository root:

```sh
bun install
```

Compile sources (add `--watch` to automatically recompile on any change):

```sh
bun run build
```

The generated `build/` directory is ignored by Git. Build locally before running
the site. The footer shows `development` by default; to preview a release version,
run `BUILD_VERSION=v1.0.1 bun run build`. `bun run build-debug` produces an
unminified bundle with the same version handling. The Pages workflow sets
`BUILD_VERSION` to the tag that triggered deployment.

Run a local webserver in the root directory:

```sh
python3 -m http.server
```

Navigate to http://localhost:8000/.

For performance benchmarking and profiling instructions, see [BENCHMARKS.md](BENCHMARKS.md).

## Headless controller input

Bun scripts can set controller input through the live `inputs` array returned by
`createHeadlessEmulator`. For example, from a script in the repository root:

```js
import { createHeadlessEmulator, loadROMFile, runCycles } from './src/headless/headless_env.js';

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

Pass `{ executeGraphics: true }` to `createHeadlessEmulator` when investigating
graphics tasks or guest scheduling. This executes HLE display lists without
pixels and raises DP interrupts on FullSync commands. The default skips lists
and approximates one DP interrupt per task; games that split a frame across
tasks, such as Griffey Slugfest and MLB, can stall under that approximation.

The shared GBI display-list runner bounds synchronous work to one million
commands, checked between batches. Exceeding that host safeguard raises
`DisplayListLimitError`; inventory reports retain it as a halt with exception
evidence, rather than claiming task completion. CPU producer waits receive a
fresh budget on resume. Object-list microcodes use separate execution paths.

## Querying graphics modes in ROM inventories

New inventory runs collect distinct draw-time RDP states in
`graphics.drawModes`. Query saved reports or an inventory directory:

```sh
bun run inventory-query /path/to/inventory --blend-mode 0xc811
bun run inventory-query /path/to/inventory --blend-mode 0xc811 --cycle-type 2cycle
bun run inventory-query /path/to/inventory --cycle-type copy --texture RGBA16
bun run inventory-summary /path/to/inventory
```

`--blend-mode` accepts a decimal or `0x`-prefixed 16-bit value: the complete
blender mux (`otherModeL >>> 16`), including both cycles. `--cycle-type` accepts
`1cycle`, `2cycle`, `copy`, or `fill`. Combined blender/cycle filters must match
the same draw state; microcode and texture filters need only match the same run.
The summary exposes all collected states so you can discover values to query.

Each state stores unsigned `otherModeH`, `otherModeL`, `combineHi`, and
`combineLo` words plus a `draws` count. The command opcode byte is removed
from `otherModeH`. Observations cover headless HLE and raw
RDP draw submissions, including rectangles, untextured triangles, lines, and
clears. Counts represent renderer submissions (triangle batches count once),
not pixels or individual triangles. A recorded blender or combiner setting may
be inactive in that cycle type; this is evidence of submitted state, not visible
blending. Configured states never submitted to a draw are excluded.

Older reports without this collector return **unknown** and need a new scan for
graphics-mode coverage. A supported empty collector means **not observed** in
that run. Partial runs can still supply matches; absence is not proof that a ROM
never uses a mode.

## Continuous integration

Pull requests run three GitHub Actions workflows. Open the failing check on the
PR for its logs and download the run's artifacts when investigating a failure.

### Lint, tests and build

The [CI workflow](.github/workflows/build.yml) runs ESLint, Bun tests and the
production build on pull requests and pushes to `main`. Run the same checks
locally from the repository root:

```sh
bun run lint
bun test
bun run build
```

Use `bun run lint:fix` to apply automatic lint fixes. Linting covers `src/`,
including tests and benchmarks, `tools/`, and the ESLint config. Warnings fail
the check as well as errors. Existing `no-unused-vars` findings are recorded in
`eslint-suppressions.json` as a baseline of counts per file; increases fail CI.
Other recommended rules remain fully enforced. When cleaning up existing unused
variables, run `bun run lint --prune-suppressions` and commit the reduced baseline.

Conditionals and loops require braces and multiline bodies. `bun run lint:fix`
adds the braces, line breaks and indentation automatically. Device implementations
in `src/devices/` may use compact braced blocks such as `if (flag) { update(); }`
to keep register handling and conditional logging readable; device tests and
benchmarks follow the normal multiline rule. Short functions may remain on one
line.

### N64 system tests

The [system-test workflow](.github/workflows/systemtest.yml) builds pinned test
ROMs from source and compares the PR against its base. It checks the main, TLB
and 64-bit-addressing groups for new failures and lost coverage. The
`n64-systemtest` artifact contains logs and JSON results for both revisions.
See the [system-test guide](tools/systemtest/README.md) for comparison policy,
configuration and debugging.

### Texture sampler visuals

The [texture-sampler workflow](.github/workflows/texture-sampler.yml) runs GPU
pixel checks and compares synthetic rendered scenes with golden images in
pinned Chromium with SwiftShader. It also verifies that a deliberately introduced
sampling regression is detected. The `texture-sampler-visuals` artifact contains
results and actual, golden and difference images for failed comparisons.
See the [texture-sampler test guide](tools/texture_sampler/README.md) for running
the checks locally, using the browser gallery and reviewing golden updates.

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

The deployment includes `index.html`, `n64js.css`, `ui.css`, `js/`, and the generated
`build/` directory. Each deployment replaces the site at the existing Pages URL.
