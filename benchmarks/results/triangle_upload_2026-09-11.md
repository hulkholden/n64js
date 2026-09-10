# Triangle upload results — 11 September 2026

Direct prefix uploads are worth pursuing on this machine. In two 8192-flush runs, they reduced upload-plus-draw completion time by about 20–34% for 1–16 triangles, 10–11% for 32 triangles, and 12% for a synthetic mixed sequence. Full 64-triangle batches were essentially unchanged. This measures the upload/draw stage, not emulator FPS.

The local prototype passes the active vertex count from Renderer.flushTris through setProgramState to the attribute setters. VertexArray.setData uses WebGL2's [bufferData source offset and element-count overload](https://registry.khronos.org/webgl/specs/latest/2.0/). Its default length of zero preserves full-array uploads for existing callers. The change creates no typed-array views per flush.

## Environment and method

- Base: master commit 333a1e3, after PR #53.
- Chromium 152 in the Codex in-app browser; ANGLE Metal, Apple M4. Hardware acceleration was active.
- WebGL2, 256 × 256 canvas, antialiasing disabled, preserveDrawingBuffer enabled, simple shader using positions, colours, and UVs.
- Three attribute uploads per flush; 84 bytes per populated triangle, versus 5376 bytes for the full 64-slot arrays.
- 11 timed samples per case, with 512 warmup flushes per variant. Variant order rotates and reverses between rounds.
- Two runs at 8192 flushes per sample and two at 2048. Timings are medians; ± values below are median absolute deviations.
- Submit measures CPU wall time to issue commands, including possible command-queue backpressure. Complete includes waiting for a GPU fence using MessageChannel tasks; it is not isolated GPU execution time.

The mixed sequence is synthetic: 1, 2, 4, 8, 16, 32, 64, 2, 1, 4, 2, 8, 1, 16, 2, 4 triangles. It averages 10.4375 triangles and 876.75 uploaded bytes per flush for the prefix variants.

## Upload plus draw

Latest 8192-flush run; microseconds per flush, including GPU completion.

| Triangles | Full arrays | Prefix range | Time reduction | Subarray | Reused bufferSubData |
|---|---:|---:|---:|---:|---:|
| 1 | 3.027 ± 0.110 | 2.356 ± 0.073 | 22.2% | 2.502 | 6.885 |
| 2 | 3.064 ± 0.037 | 2.454 ± 0.037 | 19.9% | 2.490 | 6.836 |
| 4 | 3.137 ± 0.024 | 2.332 ± 0.085 | 25.7% | 2.368 | 6.873 |
| 8 | 3.345 ± 0.171 | 2.197 ± 0.049 | 34.3% | 2.307 | 6.677 |
| 16 | 3.223 ± 0.073 | 2.576 ± 0.049 | 20.1% | 2.612 | 6.873 |
| 32 | 3.320 ± 0.061 | 2.954 ± 0.049 | 11.0% | 3.052 | 7.068 |
| 64 | 3.638 ± 0.146 | 3.601 ± 0.061 | 1.0% | 3.589 | 5.652 |
| mixed | 3.284 ± 0.049 | 2.881 ± 0.024 | 12.3% | 2.881 | 7.129 |

The ~1% difference at 64 triangles is too small to treat as a useful improvement. There is no source-byte reduction at that size.

## Repeatability and queue depth

Prefix time reductions in each run:

| Triangles | 8192, first | 2048, first | 2048, second | 8192, repeat |
|---|---:|---:|---:|---:|
| 1 | 25.0% | 29.7% | 27.5% | 22.2% |
| 2 | 19.8% | 21.5% | 16.2% | 19.9% |
| 4 | 25.8% | 25.8% | 13.2% | 25.7% |
| 8 | 30.3% | 22.2% | 11.9% | 34.3% |
| 16 | 20.2% | 24.6% | 28.0% | 20.1% |
| 32 | 10.0% | 5.9% | 22.6% | 11.0% |
| 64 | 1.0% | 4.2% | 0.0% | 1.0% |
| mixed | 11.9% | 4.6% | 14.7% | 12.3% |

Small batches consistently benefit, but shorter runs have more scheduling noise. The mixed-case gain ranged from 4.6% to 14.7% in the shorter runs, versus 11.9% and 12.3% in the longer ones. Avoid translating these percentages directly into an emulator frame-rate estimate.

## Uploads without drawing

Latest 8192-flush run; microseconds per flush.

| Triangles | Full submit | Prefix submit | Full complete | Prefix complete |
|---|---:|---:|---:|---:|
| 1 | 0.439 | 0.403 | 0.610 | 0.500 |
| 8 | 0.439 | 0.391 | 0.598 | 0.549 |
| 16 | 0.439 | 0.403 | 0.598 | 0.562 |
| 32 | 0.439 | 0.427 | 0.598 | 0.562 |
| 64 | 0.439 | 0.464 | 0.598 | 0.562 |
| mixed | 0.439 | 0.391 | 0.586 | 0.549 |

The CPU-only savings are small in absolute terms: roughly 0.04–0.05 µs per flush for small batches here. Much of the larger upload-plus-draw improvement appears when the driver must consume uploaded buffers for rendering. The experiment does not isolate the driver's internal allocation, copying, or synchronization costs.

## Alternatives

- Subarray views also reduce bytes and help drawing throughput. They cost more in the upload-only test and do not consistently beat direct ranges when drawing. Direct ranges avoid three transient views per flush.
- Reusing one fixed allocation per attribute with bufferSubData looks competitive in upload-only measurements, but takes roughly 2–2.3× the baseline completion time for most draw cases in the latest long run, and 1.55× at 64 triangles. A likely explanation is synchronization around overwriting buffers still used by queued draws; that mechanism was not separately instrumented. Ring buffers and orphaning were not tested.

## Validation and remaining scope

The final run checked 32 variant/count combinations for expected GPU buffer sizes, exact uploaded attribute data, and identical nonempty rendered pixels. It also exercised the actual Renderer.flushTris → setProgramState → VertexArray path across shrinking and growing batches, verified empty-buffer handling, and checked rectangle/default full-array uploads. Shader selection, texture binding, and depth/blend setup were stubbed only for this focused renderer-path check.

All 61 existing tests, ESLint, and the production build pass. No real game frame-rate benchmark or cross-browser/GPU comparison has been run. The next useful measurement is a representative scene's flush-size distribution and frame time.

See [benchmark instructions](../README.md), [benchmark page](../triangle_upload.html), and [all raw samples and metadata](triangle_upload_2026-09-11.json). Run 1 was an exploratory pilot with timer-clamped fence polling; its completion figures were superseded and are not used above.
