# Triangle uploads

Serve the repository root (`python3 -m http.server`), then open
`http://localhost:8000/benchmarks/triangle_upload.html` and click **Run benchmark**.
No additional packages or ROM are required. Use a hardware-accelerated browser.

The page compares three separate attribute uploads per flush:

- `full`: the original three-argument `bufferData`, uploading all 64 triangle slots.
- `subarray`: three new typed-array views selecting the populated prefixes, passed to `bufferData`.
- `range`: `VertexArray.setData` using WebGL2's source offset and element count.
- `subdata`: allocate full-size buffers once, then overwrite populated prefixes with `bufferSubData`.

It uses the repository's `TriangleBuffer`, `ProjectedVertex`, and `VertexArray`, with a
small shader that reads all three attributes. Before timing it verifies the GPU buffer
sizes, uploaded attribute contents, and identical nonempty rendered images, including
shrinking and growing uploads. It also checks full-array defaults used by rectangles.

The two modes measure uploads alone and uploads followed by a draw. Cases cover
1, 2, 4, 8, 16, 32, and 64 triangles per flush, plus the repeating synthetic sequence
`1, 2, 4, 8, 16, 32, 64, 2, 1, 4, 2, 8, 1, 16, 2, 4`.

Each case warms up every variant with 512 flushes. Timed rounds rotate and reverse
variant order. `iterations` controls flushes per timed sample and `samples` controls
the number of rounds, for example:

`http://localhost:8000/benchmarks/triangle_upload.html?iterations=8192&samples=11`

- **Submit** is CPU wall time spent issuing the uploads and optional draws. It can
  include backpressure from the browser/driver when the command queue fills.
- **Complete** includes waiting for a WebGL fence after the sample. It is wall time,
  not isolated GPU execution time. MessageChannel tasks poll the fence without the
  nested timer clamp; polling and scheduling overhead are included.
- The table reports medians in microseconds per flush. Raw results include each
  sample, median absolute deviations, and browser/GPU metadata.
- **Bytes** counts source attribute bytes uploaded, not all internal driver traffic.

This is a synthetic upload/draw benchmark, not an emulator frame-rate benchmark.
Vertex packing, shader selection, texture binding, depth/blend changes, and emulation
are outside the timed loop. Results depend on queue depth, batch sizes, browser,
driver, and GPU. A real scene's flush-size distribution is needed to predict its gain.

The optional `save=1` parameter POSTs raw JSON to `/__benchmark_results` on the same
local server, if it provides that endpoint. Omit it for a standard static server;
the complete JSON is always available under **Raw results**.
