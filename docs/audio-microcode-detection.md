# Audio microcode observations

Audio tasks still execute through RSP LLE. This change observes their initial
microcode at task start; it does not enable audio HLE or change task timing.
Inventory reports add `audio.taskMicrocodes` (collector version 1), and queries
accept `--audio-microcode ABI1`, `NAUDIO`, `NEAD`, or `Unknown`. Old reports remain
readable: a missing audio collector is unknown, not evidence of no audio.

## Research and approach

A useful detector must distinguish the command ABI family, a particular code
revision, and compatibility with an eventual HLE implementation. These are
separate claims. A game name or an audio task's type does not establish any of
these beyond the task's declared purpose.

The approaches considered were:

- **Embedded names/version strings.** Useful when supplied, as in many graphics
  microcodes, but the sampled audio images have no reliable identifying string.
- **Image checksums or a catalogue of short signatures.** Useful for known
  binaries, but a checksum cannot explain an unfamiliar image. The task's size
  fields and the DMA image can include unrelated or mutable memory.
- **Selected data words.** Existing emulator detectors use constants and handler
  addresses as signatures. Inspecting the assembly explains why these often
  work: some identifying words are pairs of addresses in a command jump table,
  not explicit vendor or version tags. Moving a function changes these values;
  changing its arithmetic without moving it need not change them.
- **Executable structure.** Recover the loading layout, command-byte extraction,
  indirect dispatch, and distinctive command parameter handling. This is the
  approach implemented here, using the documentation and local ROM observations
  described below. There is no borrowed emulator signature table, game-name
  lookup, or HLE processing implementation.

Primary references:

1. [Nintendo's microcode introduction](https://ultra64.ca/files/documentation/online-manuals/man/kantan/step1/1-7.html)
   describes audio synthesis using 64-bit ABI commands and the aspMain/n_aspMain
   microcodes.
2. [Nintendo's n_audio improvements](https://ultra64.ca/files/documentation/online-manuals/man/pro-man/pro28/28-01.html)
   explains the fixed 184-sample processing blocks.
3. [The reconstructed SM64 audio assembly](https://github.com/n64decomp/sm64/blob/master/rsp/audio.s)
   exposes command-word loading, the halfword dispatch table, SETBUFF, and the
   expanded command layout used by later SM64 versions. It is a microcode
   reconstruction, not an emulator's identification implementation.
4. [The reconstructed RSP bootstrap](https://github.com/n64decomp/sm64/blob/master/rsp/rspboot.s)
   shows the fixed 0xf80-byte code DMA into IMEM at 0x1080 and loading task data
   into DMEM. The declared code size is not used by this loader.
5. [SGI's ABI command definitions](https://github.com/n64decomp/libreultra/blob/master/include/2.0I/PR/abi.h)
   describe the standard command numbers and parameter fields.
6. [Mupen64Plus's identification implementation](https://github.com/mupen64plus/mupen64plus-rsp-hle/blob/master/src/hle.c)
   was examined as an example of selected-data-word signatures. Its decision tree
   and signature constants were not used to implement this detector.
7. [Daedalus/Azimer’s audio dispatcher](https://github.com/DaedalusX64/daedalus/blob/master/Source/HLEAudio/HLEMain.cpp)
   illustrates the same broad selected-word approach and detection once per game.
   Here, every observed task is inspected so later revisions are not hidden by
   an earlier classification.
8. [Project64's graphics microcode checker](https://github.com/project64/project64/blob/develop/Source/Project64-video/rdp.cpp)
   provides a contrasting fixed-range checksum example: it sums the first 3 KiB,
   excluding a potentially unrelated final 1 KiB. This is a graphics example,
   not an audio identification rule; it illustrates why a hash needs a carefully
   defined input range.

## Derived rules

The observer reads the bootstrap actually loaded into IMEM. This matters when
its task pointer refers to cartridge memory, as in Conker. A standard loader is
recognized by the instructions loading the task's code pointer, setting a
0xf80-byte DMA to 0x1080, and writing the corresponding SP DMA registers. A full
4 KiB direct task with matching boot/code pointers instead uses the actual IMEM
image at 0x1000. Unsupported layouts remain unknown. All RDRAM reads are bounded;
invalid ranges are reported without following command lists or sample pointers.

For an audio-list dispatcher, two adjacent 32-bit command words are loaded.
Shifting the first right by 23 and masking with 0xfe produces twice its command
number. The program loads a signed/unsigned halfword from the derived table and
jumps to that address. The detector follows this short expression rather than
assuming a particular dispatcher PC, register allocation or table offset.

Family evidence is deliberately limited:

- **ABI1:** 16 command slots; command 8 stores input/output/count as adjacent
  halfwords; commands 4 and 6 read the stored count. This includes distinct
  arithmetic revisions such as those observed in Mario, Tetrisphere and Rare
  games. An ABI1 label does not select a single interchangeable HLE handler.
- **NAUDIO:** 16 slots; load/save commands 4 and 6 extract a packed 12-bit count
  and DMEM offset; interleave command 13 uses 368 bytes (184 16-bit samples).
  Reserved table slots can contain scratch values rather than entry points.
- **NEAD:** an extended table of at least 24 entries; SETBUFF behaviour; load/save
  commands 20 and 21 call a shared packed-count decoder. The family name is
  conventional; the evidence describes the observed layout, not a vendor tag.
- **Unknown:** no supported loader/dispatcher, ambiguous candidates, or an
  unfamiliar command layout. Invalid/truncated data is distinguished by
  `detection: "invalid"`. There is no assumed default audio family.

These rules were derived using task images from local USA ROMs including Mario,
Tetrisphere, GoldenEye, Diddy Kong Racing, Banjo-Kazooie/Tooie, Mario Kart, Star
Fox, F-Zero X, Yoshi's Story and Ocarina of Time. MusyX-style tasks sampled from
Rogue Squadron, Resident Evil 2 and Indiana Jones do not have this dispatcher
and remain unknown. The tests use independently constructed synthetic RSP
programs, with relocated tables/handlers and different registers; no ROM bytes
are included in the repository.

## Revision identity and limitations

`fingerprint` is a SHA-256 over the loading interpretation and two component
hashes. `fingerprintScope: "static-code-and-dispatch"` means:

- `codeHash` covers address/instruction pairs reached by following static control
  flow from the entry point and every recognized dispatch-table handler. Calls,
  conditional paths and branch delay slots are included.
- `dataHash` covers the recovered dispatch table. Scratch memory and unrelated
  bytes after the program are excluded.

This is an **observed code/dispatch revision**, not a full-image checksum, an SDK
release name or proof of behavioural equivalence. Constants outside the table,
non-dispatch indirect jump targets, self-modification and later code overlays are
not fully represented. Unknown loaders instead use
`fingerprintScope: "unresolved-code-image"`, which can include unrelated bytes.
The report retains the fingerprint scope, loading evidence, first observed image
sizes, individual hashes and task counts. It does not export ROM binaries.

The distinction is experimentally important: whole-image hashing initially
split Tetrisphere's first 585 audio tasks into 585 apparent revisions. Excluding
scratch/tail bytes groups those tasks into one code/dispatch revision. Conversely,
changing a reached instruction or a dispatch entry changes the fingerprint even
when the family stays the same. No address-only cache can hide a guest rewrite.

A second local check found that the sampled Mario and Tetrisphere programs have
identical dispatch tables but different instructions in the MIXER handler. The
fingerprints distinguish them. GoldenEye and Diddy Kong Racing also retain
separate code revisions while sharing the ABI1 family. This is a concrete reason
not to treat a handler-address signature as a complete compatibility test.

Before enabling HLE, compatibility must be established separately for each
supported code revision, including relevant constants and overlay behaviour.
Unknown tasks will continue to use LLE.

## Inventory validation

The [full inventory validation record](audio-microcode-inventory.md) records the
858-ROM scan, follow-up corrections, coverage and remaining unknowns.

In addition to synthetic tests, representative handlers were executed through
n64js's RSP interpreter as an independent check on the decoded structure. Buffer
setup wrote the expected input/output/count fields in Mario, Tetrisphere,
GoldenEye, Diddy Kong Racing, Mario Kart, Star Fox, F-Zero X, Yoshi's Story and
Ocarina of Time. Interleave produced exactly 184 stereo sample pairs in
Banjo-Kazooie, Banjo-Tooie and Conker. This validates the specific distinguishing
behaviours, not every operation in those microcodes.

Use `bun run inventory-batch /Volumes/Data/Roms --output-dir build/audio-inventory`
for a complete scan with the usual 600-VI, seed-1 limits. A completed run means
only that its frame budget was reached; it does not prove gameplay or coverage
of all tracks, menus and runtime overlays. Failures/timeouts retain their last
collector checkpoint, while a valid empty collector means no audio task was
observed during that run.

Two useful edge cases emerged during the full scan. Doubutsu no Mori loads its
adjacent command words from fixed DMEM addresses, rather than offsets 0/4 from a
moving pointer; the relationship between the addresses is what matters. Jet
Force Gemini has a different bootstrap: the code DMA setup is separated from
the task-pointer load by control flow. The present loader recognizer leaves
that case unknown. Recognizing the eventual DMA destination alone would not
establish which program is loaded.

Use `bun run inventory-summary build/audio-inventory` to summarize recorded
coverage and `bun run inventory-query build/audio-inventory --audio-microcode Unknown`
to find unclassified observations. Detection does not depend on the ROM name,
region, byte order, or inventory input policy.
