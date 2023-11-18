# TODO

## General
* Persist disassembly labels across sessions?

## CPU

* LDL and SDR - Final mask shouldn't be needed - BigInt bug?
    const result = ((reg & ~(mask << shift)) | (mem << shift)) & mask;