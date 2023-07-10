# TODO

## General
* Persist disassembly labels across sessions?
* Get rid of the readU32() stubs which just do readS32()>>>0.

## CPU

* LDL and SDR - Final mask shouldn't be needed - BigInt bug?
    const result = ((reg & ~(mask << shift)) | (mem << shift)) & mask;