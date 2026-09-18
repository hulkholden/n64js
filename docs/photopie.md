# Mario no Photopie: empty SmartMedia slots

This implements the startup/no-media subset of [issue #90](https://github.com/hulkholden/n64js/issues/90).
Only the database entry `ac90989adf13c3f0` enables it. Both SmartMedia slots
are empty; there is no card image, synthesized filesystem, or ROM patch.

## Evidence and scope

The register reference is LuigiBlood's [SmartMedia_CartMapper.js](https://github.com/LuigiBlood/EmuScripts/blob/bab9e07e031eb57b3f2dbfe31181ded9cc5b3850/N64/Project64_JSAPI2/SmartMedia_CartMapper.js),
introduced in commit `bab9e07e031eb57b3f2dbfe31181ded9cc5b3850` on 2022-01-03.
Its earlier [SmartMedia.js](https://github.com/LuigiBlood/EmuScripts/blob/c0324cde8f559edd9f661d8a77619fd720121e36/N64/Project64/SmartMedia.js)
uses the same register definitions. These are partial emulator simulations,
not a published hardware trace. The behavior below is verified against this
documented implementation and the unmodified game's accesses, **not against
physical cartridge hardware**.

`0xafe7013c` is KSEG1 address `0x0fe7013c` on the cartridge bus: slot 1's
`UNLOCK` register. Slot 1 starts at `0xafe70100`, slot 2 at `0xafe70140`.
The reference names a separate crypto area at `0xafe70000..0xafe70013`;
that area is not accessed during the observed empty-slot startup and is not
implemented here.

Offsets below are relative to each slot base. The game uses 32-bit CPU loads
and stores, with byte-valued register contents.

| Offset | Reference name | Implemented startup behavior |
| --- | --- | --- |
| `0x00` | `STAT` | Read `0x47`: reference default `0x43` plus `EMPTY=0x04`; busy bits are clear. |
| `0x04` | `CMD` | Read `0`; the reference's `CARD_PRESENT=0x04` bit is clear. Media commands are unsupported. |
| `0x08` | `ADDR` | Read `0xff`, as in the reference. Address writes are unsupported. |
| `0x20` | `MAGIC_LO` | Read low seed byte; writes latch the low response separately. |
| `0x24` | `MAGIC_HI` | Read high seed byte; writes latch the high response separately. |
| `0x3c` | `UNLOCK` | Latch writes, including the game's `1` then `0` sequence. |

The reference explicitly initializes seeds to `0xfff0` and `0xc000` for the
two slots. It does not validate response writes, gate reads on unlock state,
or simulate authentication/busy timing. Neither does this implementation.
In particular, writing the response does not manufacture a success flag or
make a card appear. The reference creates its slot objects with `Object.create`
and inadvertently shares their nested register object; the validation adapter
cloned those register objects so each slot retained its specified seed. n64js
owns independent slot state and tests it explicitly.

The meaning of the unknown bits in the reference's default `0x43`, real seed
generation, authentication failure behavior, and physical unlock timing remain
unverified. The reference's fixed seeds are a simulation choice. They must not
be presented as measured power-on values.

## Observed startup exchange

The ROM performs the following sequence once per slot, through its PI CPU-I/O
helpers at PCs `0x80096c98` (write) and `0x80096b3c` (read):

1. Write `UNLOCK=1`, then `UNLOCK=0`.
2. Read the low and high seed bytes.
3. Write low and high response bytes: `94 59` for slot 1, `d6 47` for slot 2.
4. Read `STAT=0x47` and `ADDR=0xff`.
5. Later, read `STAT=0x47` again from both slots.

No card command, data-port access, ECC access, crypto access, or card DMA was
observed in the 30-second neutral trace. The tests replay this exchange and
check response/seed separation, independent latches, reset, mapper removal
when loading another ROM, and rejection of unsupported accesses. Unknown slot
accesses report an explicit error instead of silently succeeding. Unrelated
cartridges retain their existing ROM/save handlers.

## Validation, 2026-09-13

Base revision: `c2b7ad1fc0a453eaf1a511b491cc67050e1bdd9c`.
ROM: `Mario no Photopie (J) [!].z64`, byte-order-normalized SHA-256
`90dc5fa56342acace1e9120baad267c6aecc00e0f1a3b073ac3caa53766d5f67`.
The supplied file's raw SHA-256 differs because it needs byte-order conversion.
Runtime: Bun 1.3.14 on macOS, fresh save state, 8 MiB RDRAM, default HLE graphics
and LLE audio, dynamic recompilation and speed hacks enabled, RNG seed 1.
An independent CPU event measures elapsed time, rather than guest-writable COUNT.

| Run | Emulated seconds | Graphics tasks | Audio DMAs | VI retraces | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Base, neutral | 1.065719669 | 0 | 0 | 60 | Halts writing `1` to `0xafe7013c`, PC `0x80096c98`. |
| Fixed, neutral | 30 | 3335 | 1301 | 1796 | No fatal error; PC `0x80040674`. |
| Fixed, Start/A input | 30 | 4660 | 1301 | 1796 | No fatal error; PC `0x80040674`. |
| Fixed, neutral, HLE lists executed | 30 | 3335 | 1301 | 1796 | Same progress and final PC; background-rendering warning. |
| Reference adapter, independent slots, HLE lists executed | 30 | 3335 | 1301 | 1796 | Same neutral progress and final PC. |

Use the [portable harness in #86](https://github.com/hulkholden/n64js/issues/86)
as `build/boot-audit-repro.mjs` after `bun install --frozen-lockfile`:

```sh
bun build/boot-audit-repro.mjs '/path/to/Mario no Photopie (J) [!].z64' 30
bun build/boot-audit-repro.mjs '/path/to/Mario no Photopie (J) [!].z64' 30 input
```

That harness skips headless display-list execution by default. Add
`executeGraphics: true` to its `createHeadlessEmulator` options to exercise
HLE display lists without rasterization. Its input mode pulses Start at
3/6/9 seconds and A at 12/15/18/21/24/27 seconds.

The browser build was also exercised with both slots empty, fresh state, and
neutral input. A diagnostic page drove CPU batches directly (bypassing browser
frame/audio pacing) to the same independent 30-second deadline while retaining
the browser's HLE renderer and LLE audio. It reached the same 3335 graphics
tasks, 1301 audio DMAs, 1796 VI retraces, and final PC as the headless run.
The canvas remains black; the renderer warns
`gSPBgRect1Cyc: unimplemented` at CPU PC `0x800963fc`. Headless display-list
execution identifies F3DEX 1.23 and S2DEX 1.07. `S2DEXCommon.executeBg1cyc`
currently decodes the background descriptor and warns without drawing it.
This is a rendering limitation exposed by getting past cartridge startup;
it is not evidence that implementing this single command will fix every
remaining visual problem. **Visible title/menu startup and playability remain
unverified.**

Additional checks:

- `bun test src`: 232 pass, 0 fail.
- `bun run lint`, `bun run build`, and `git diff --check`: pass.
- Super Mario 64 (U), 10-second neutral smoke: 204 graphics tasks, 575 audio
  DMAs, 596 VI retraces, no fatal error.
- Supplied `n64-systemtest.z64`, SHA-256
  `a2122627036944ef107589c39894136d1d3dcf25f53b8b244bf80a6c237d0f06`,
  `bun src/headless.js /path/to/n64-systemtest.z64`: before and after logs are
  byte-for-byte identical, with 997 test headings and 144 failure reports.
  Both reach the existing exception-storm abort in
  `TLB: linear icache across split 4K PFN (64-bit VA)` and the harness cycle
  limit. Tests after that abort remain unverified.

## Remaining work

- [#99 — Cartridge authentication and mounted SmartMedia](https://github.com/hulkholden/n64js/issues/99):
  verify cartridge authentication and actual empty-slot behavior on hardware.
  Then implement card insertion/removal, NAND commands and address cycles,
  data transfers, image persistence, write protection, ECC and crypto behavior
  using documented/tested semantics. This patch provides no mounted-media API.
- [#100 — Black screen and S2DEX background rendering](https://github.com/hulkholden/n64js/issues/100):
  investigate S2DEX background rendering and capture the title/menu once it
  draws. Keep this separate from the cartridge protocol implementation.
