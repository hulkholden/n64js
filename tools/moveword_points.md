# MoveWord Points / ForceMatrix reproducer

Build `bun build tools/moveword_points_webgl.js --outfile=build/moveword_points_webgl.js`, serve the repository over HTTP, and open `tools/moveword_points_webgl.html` in a WebGL2 browser. The page checks 14 framebuffer pixels and displays the rendered scenes. Run command tests with `bun test src/hle/moveword_points.test.js`.

The same MoveWord index (0x0c) has different meanings:

- Fast3D/GBI1: a write into a 40-byte transformed vertex record. RGBA, signed s10.5 ST, signed s13.2 screen XY and unsigned 16.16 screen Z use the shared ModifyVertex handler. The scene shows RGBA/alpha writes affecting subsequent triangles.
- F3DEX2/GBI2: the combined-matrix valid flag, named `G_MW_FORCEMTX`. A MoveMem matrix load followed by the nonzero flag uses that matrix without changing the projection/modelview stacks. A zero flag, matrix command or pop invalidates the override. The scene draws a triangle with the stack transform, a forced narrow transform, then the restored stack transform.

Encoding references: [GBI macros](https://github.com/glankk/libgfxd/blob/master/gbi.h), [Fast3D Points decoder](https://github.com/gonetz/GLideN64/blob/master/src/uCodes/F3D.cpp), [F3DEX2 ForceMatrix decoder](https://github.com/gonetz/GLideN64/blob/master/src/uCodes/F3DEX2.cpp).

Issue #287's recognized WCW-nWo Revenge (Europe) sample was reproduced on d0dea1f. The first flag is preceded by `dc38000e 003c5500`, then `db0c0000 00010000`: the standard ForceMatrix pair, rather than a vertex update. With this change, seed 1 completes 1,800 VI retraces and 3,399,067,679 cycles without the former `MoveMem G_GBI2_MV_MATRIX` or `MoveWord Points` warnings. Canonical ROM SHA-256: `e4bd4f49d6e2217294cd2f9178488349eabd44155e4ad0436a9d1ddef58c53da`.

The browser scene verifies the rendered command effects. The ROM run uses the null renderer and does not establish game pixel correctness or resolve the other 37 inventory observations individually. Unrecognized ForceMatrix offsets still warn; matrix insertion (MoveWord index 0) remains outside this change.
