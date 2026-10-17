# GBI2 texture rectangle command investigation

Issue [#378](https://github.com/hulkholden/n64js/issues/378) groups three different
command sequences under the incomplete-rectangle warning. The All-Star Baseball
sequence is valid: it retains the previous `RDPHalf1` S/T word and supplies only
`RDPHalf2`. The other two captured sequences still need the truncation guard.

## Microcode evidence

All-Star Baseball 2000 (Europe) uses F3DLX.Rej fifo 2.05, hash `0x618f7823`.
Its dispatch table and command handlers show:

- `E4`/`E5` enter the overlay at IMEM `0x102c`, storing the rectangle header
  in DMEM `0xd0`/`0xd4`. They leave the S/T word at `0xd8` unchanged.
- `E1` enters at `0x1030` and stores its payload at `0xd8`.
- `F1` enters at `0x11f8`, copies the saved rectangle header into the output
  buffer, then appends the word from `0xd8` and its own derivative payload.
- The task's initial microcode data contains zero at `0xd8`. This latch belongs
  to RSP task state, not persistent RDP state.

A local RSP interpreter replay of those original handlers, with synthetic
commands and a nonzero S/T value, produced these two RDP packets:

```text
Input:  E428C078 0024C048, E1000000 00200040, F1000000 04000400
Output: E428C078 0024C048 00200040 04000400

Input:  E42B007C 00270048, F1000000 08000200
Output: E42B007C 00270048 00200040 08000200
```

This verifies reuse rather than assuming the omitted word is always zero. No
ROM or microcode binaries are included in the repository.

## Captured streams

These captures use public base `668dee1956b750751ed2c35a923b2a7a04a1a480`,
Bun 1.3.14, seed 2, random-controller v1 / mulberry32, fresh saves, HLE graphics
with the null renderer, default HLE audio, 1,800 VIs and a five-billion-cycle
ceiling. A temporary wrapper counted calls to `GBIMicrocode.warn` before console
suppression and inspected the commands at `GBI2.readTexRectParams`. Runs were
serialized under `/tmp/perf.lock`; these are correctness observations, not
speed measurements. They are separate from the historical inventory snapshots.

### All-Star Baseball 2000 (Europe)

Canonical ROM SHA-256:
`2e30b758271c441eab2ed35dcf3a542fd46782522607c2fd6b1663771b756e07`.
First rejected rectangle: VI 38, PC `0x135b00`.

```text
F2000000 0003C02C  SetTileSize
E428C078 0024C048  TextureRectangle
F1000000 04000400  RDPHalf2
FD500000 80464E10  SetTextureImage
```

The base rejected 64,527 of 198,392 rectangles. With the fix it rejects zero,
with the same 1,800 VIs and 3,415,661,498 CPU cycles. The following texture-image
command remains a separate command.

### WinBack — Covert Operations (USA)

Canonical ROM SHA-256:
`526b30f315ab44e6916906ae5851c924b6862e78b2f686356addb44ef26a48cc`.
F3DEX fifo 2.08, first warning VI 1380, PC `0x1f0720`:

```text
E4130130 00030030  TextureRectangle
00200020 04000400  Raw parameter words, not E1/F1 commands
DA380003 80134910  Matrix
```

Both the base and fix report 181 rejected rectangles. This is a different encoding from
the All-Star Baseball case; the fix does not reinterpret arbitrary following
words as parameters. Its intended submission path remains a separate question.

### Triple Play 2000 (USA)

Canonical ROM SHA-256:
`61685117852b7a202c8dbc21a5b80c601980e48c937aa036d659605e7043287b`.
F3DEX xbus 2.05, first warning VI 1745, PC `0x91610`:

```text
E4680514 0067C510  TextureRectangle
E1000000 00000000  RDPHalf1
DF000000 00000000  EndDL
```

Both the base and fix report 19 rejected rectangles. There is no `RDPHalf2` to complete
the rectangle. Preserve `EndDL` and the warning; swallowing it would read
unrelated memory as display-list commands.

## Regression coverage

All-Star Baseball 2000 (USA) and All-Star Baseball 2001 (USA) also reached
1,800 VIs with zero rejected rectangles on seed 2 (181,739 and 218,078
rectangle attempts respectively). WinBack and Triple Play reached 1,800 VIs
on both revisions with unchanged CPU cycles and rejection counts.

Browser captures of All-Star Baseball 2000 (Europe), seed 2, use fresh storage,
Chromium 145.0.7632.6, HLE graphics, render scale 1 and CRT off. Both captures
stop at VI 100 / 228,161,498 CPU cycles. The fix restores the missing title
and credit lines. No browser page errors were reported. Screenshots are
attached to the pull request rather than storing game assets in the repository.

`gbi2_texture_rectangle_commands.test.js` covers full and shortened rectangles,
retained nonzero S/T, standalone `RDPHalf1`, both flip modes and disassembly,
task reset, following commands, `EndDL`, branches, counted-list boundaries,
RAM boundaries and truncated words. It also preserves the WinBack raw-word
guard and the existing Triple Play fixture.

For an uninstrumented replay with a local ROM, run:

```sh
bun run inventory '/path/to/All-Star Baseball 2000 (Europe).z64' \
  --seed 2 --frames 1800 --max-cycles 5000000000 --timeout-ms 60000 \
  --output /tmp/allstar-texrect.json
```

Acquire `/tmp/perf.lock` with `flock` semantics before bounded ROM replays.
Console warnings are deduplicated; counting their printed lines does not
reproduce the occurrence counts above. Reaching the VI budget alone does not
establish correct gameplay or pixels.
