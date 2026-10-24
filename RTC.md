# Cartridge RTC

n64js implements the cartridge Joybus RTC interface used by Doubutsu no Mori
(Animal Forest) and libdragon homebrew. This is a functional model of the
documented software interface, not a cycle-accurate model of the underlying IC.
The N64DD clock uses a different interface and is not covered.

## Sources

The implementation and protocol tests were derived from these hardware-facing
SDK sources, without consulting another emulator's implementation:

- [libdragon RTC documentation](https://libdragon.dev/ref/group__rtc.html) and
  [rtc.h](https://github.com/DragonMinded/libdragon/blob/trunk/include/rtc.h):
  cartridge scope, block layout, and known gaps in hardware documentation.
- [libdragon rtc.c](https://github.com/DragonMinded/libdragon/blob/trunk/src/rtc.c):
  Joybus packet sizes, identifier byte order, BCD encoding, stop/status bits,
  write protection, and the stop/set/resume programming sequence.
- [libdragon ed64romconfig.c](https://github.com/DragonMinded/libdragon/blob/trunk/tools/ed64romconfig.c):
  the `ED` homebrew signature and RTC configuration bit. This is a ROM-header
  producer, not a peripheral implementation.

Libdragon credits marshallh and jago85 for reverse engineering the protocol.
It also explicitly prioritizes compatibility with existing hardware and flash
carts over exact Animal Forest RTC behavior. These sources establish the
supported programming sequence; they do not establish every possible register
combination or malformed transaction's behavior.

## Presence and commands

The browser and headless ROM loaders set `rominfo.rtc` independently of the save
type. The Animal Forest and Doubutsu no Mori entries in `romdb` declare
`rtc: true`. Other revisions or ROM hacks can declare the same capability in
their own database entries. Without a database RTC setting, homebrew opts in
with `ED` at `0x3c..0x3d` and bit 0 set at `0x3f`. An unrelated cartridge with
the same revision bit set does not get an RTC. Direct hardware/headless callers
can set `rominfo.rtc: true`.

Channel 4 accepts these commands when `hardware.rtc` exists:

| Command | TX bytes | RX bytes | Response |
| --- | --- | --- | --- |
| `06` identify | 1 | 3 | `00 10 status` |
| `07 block` read | 2 | 9 | Eight data bytes, then status |
| `08 block data[8]` write | 10 | 1 | Status |

Status is `00` while running or `80` while stopped. RTC absence leaves receive
bytes untouched and uses the existing PIF no-response flag. EEPROM commands
remain independent and work when an RTC is present.

| Block | Contents |
| --- | --- |
| 0 | Big-endian control word followed by six opaque bytes |
| 1 | Eight bytes of retained data |
| 2 | BCD second, minute, hour with bit 7 set, day, weekday, month, year, century |

Weekday is 0 (Sunday) through 6 (Saturday), month is 1 through 12, and the full
year is `1900 + year + 100 * century`. Reads sample the clock once for the whole
block. The calendar uses Gregorian leap-year rules.

Control bit `0004` stops the clock, `0100` protects block 1, and `0200` protects
block 2. The initial control word is `0300`. The documented write sequence is:
read block 0 to preserve calibration, write control `0004`, write time to block
2, then write control `0300`. Stopping freezes elapsed time; resuming continues
from the programmed time, without adding the stopped interval.

## State and clock

`rtcNow` in the `Hardware` and `createHeadlessEmulator` options supplies host
milliseconds and defaults to `Date.now`. Tests use a controlled clock, without
sleeping. The RTC advances independently of emulated instruction count or speed.
Initial civil time comes from the host's local time. Thereafter calendar
arithmetic does not apply host timezone or DST changes. Explicit host wall-clock
adjustments still affect elapsed time; this is not an oscillator simulation.

Console reset preserves the live RTC, including pending writes. Browser storage
uses the existing per-ROM namespace with a separate `rtc` key. Initial state and
writes are flushed at vertical blank, and replacing a cartridge flushes its RTC
under the old ROM identity. Running clocks advance while unloaded; stopped
clocks stay frozen. Read-only polling does not rewrite storage every frame.
Headless runs retain the existing headless behavior of having no disk-backed
save storage. Invalid saved records are ignored.

## Deliberate approximations and remaining validation

- Writes complete synchronously. The SDK's waits remain safe, but write-busy
  timing and oscillator startup delays are not emulated.
- Calibration and unknown control bits are retained for read-back, without
  modeling their electrical effects.
- Libdragon describes block 1 storage as theoretical and unused by Animal
  Forest. Treating it as eight retained bytes with independent write protection
  is a model choice, not a verified hardware result.
- Only the documented 24-hour time encoding is accepted. Protected time writes
  and time writes made while running are acknowledged but ignored. The latter
  is a conservative model choice because the supported sequence stops first.
- Weekday is modeled as an independent writable counter. Invalid BCD or calendar
  dates are rejected atomically. Unsupported blocks and malformed TX lengths
  receive no response. Exact silicon behavior in these cases is unverified.
- Short/long RX buffers use existing PIF overrun/underrun reporting and never
  permit a response to overwrite adjacent frame data.

Tests cover the SDK programming sequence, leap days and century rollover,
write protection, EEPROM coexistence, SI DMA, cartridge switching, reset, and
storage reload.

Doubutsu no Mori (Japan), ROM ID `6d208ebd1c5ec398`, completed a headless startup
check with graphics execution enabled: 600 VI frames, 962,757,468 CPU cycles,
217 RTC identification commands and 432 time-block reads, without warnings or
a fatal error. RTC traffic began at frame 172. The injected clock started at
2024-02-29 12:34:56 and advanced by 1/60 second per VI; the first and last time
responses represented 12:34:58 and 12:35:05. No time writes occurred in this
startup check. Full gameplay, guest-driven time setting, and physical hardware
comparison remain unvalidated. No ROM data is included in the repository.
