/*global n64js*/

//
// Memory access routines.
//
// These helpers are structured to provide a fast path for accesses to unmapped physical memory, with the
// slow path calling out to a separate function. This means that if Chrome deopts the slow path function
// it won't affect performance of the fast path.
//
// The fastpath helpers compare addresses to -2139095040 to perform a quick check to see if the address is
// in bounds for ram (0x8000_0000 <= x < 0x8080_0000). The constant is derived from interpreting 0x80800000
// as a 32-bit signed value.

// TODO: Figure out how to explicitly add a dependency on this - it's brittle to depend
// on n64js.hardware() being initialized before this module is loaded.
const getMemoryHandler = n64js.hardware().memMap.getMemoryHandler.bind(n64js.hardware().memMap);
const ramDV = n64js.hardware().cachedMemDevice.mem.dataView;

export function loadU64slow(addr) {
  if (addr & 7) { n64js.cpu0.unalignedLoad(addr); }
  return getMemoryHandler(addr).readU64(addr);
}
export function loadU16slow(addr) {
  if (addr & 1) { n64js.cpu0.unalignedLoad(addr); }
  return getMemoryHandler(addr).readU16(addr);
}
export function loadU32slow(addr) {
  if (addr & 3) { n64js.cpu0.unalignedLoad(addr); }
  return getMemoryHandler(addr).readU32(addr);
}
export function loadU8slow(addr) { return getMemoryHandler(addr).readU8(addr); }

export function loadS32slow(addr) {
  if (addr & 3) { n64js.cpu0.unalignedLoad(addr); }
  return getMemoryHandler(addr).readS32(addr);
}
export function loadS16slow(addr) {
  if (addr & 1) { n64js.cpu0.unalignedLoad(addr); }
  return getMemoryHandler(addr).readS16(addr);
}
export function loadS8slow(addr) { return getMemoryHandler(addr).readS8(addr); }

export function store64slow(addr, value) {
  if (addr & 7) { n64js.cpu0.unalignedStore(addr); }
  getMemoryHandler(addr).write64(addr, value);
}
export function store32slow(addr, value) {
  if (addr & 3) { n64js.cpu0.unalignedStore(addr); }
  getMemoryHandler(addr).write32(addr, value);
}
export function store16slow(addr, value) {
  if (addr & 1) { n64js.cpu0.unalignedStore(addr); }
  getMemoryHandler(addr).write16(addr, value);
}
export function store8slow(addr, value) { getMemoryHandler(addr).write8(addr, value); }

export function store32masked(addr, value, mask) { getMemoryHandler(addr).write32masked(addr, value, mask); }
export function store64masked(addr, value, mask) { getMemoryHandler(addr).write64masked(addr, value, mask); }

export function loadU8fast(sAddr) {
  if (sAddr < -2139095040) {
    const phys = (sAddr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
    return ramDV.getUint8(phys, false);
  }
  return loadU8slow(sAddr >>> 0);
}

export function loadS8fast(sAddr) {
  if (sAddr < -2139095040) {
    const phys = (sAddr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
    return ramDV.getInt8(phys, false);
  }
  return loadS8slow(sAddr >>> 0);
}

export function loadU16fast(sAddr) {
  if ((sAddr & 1) == 0 && sAddr < -2139095040) {
    const phys = (sAddr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
    return ramDV.getUint16(phys, false);
  }
  return loadU16slow(sAddr >>> 0);
}

export function loadS16fast(sAddr) {
  if ((sAddr & 1) == 0 && sAddr < -2139095040) {
    const phys = (sAddr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
    return ramDV.getInt16(phys, false);
  }
  return loadS16slow(sAddr >>> 0);
}

export function loadU32fast(sAddr) {
  if ((sAddr & 3) == 0 && sAddr < -2139095040) {
    const phys = (sAddr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
    return ramDV.getUint32(phys, false);
  }
  return loadU32slow(sAddr >>> 0);
}

export function loadS32fast(sAddr) {
  if ((sAddr & 3) == 0 && sAddr < -2139095040) {
    const phys = (sAddr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
    return ramDV.getInt32(phys, false);
  }
  return loadS32slow(sAddr >>> 0);
}

export function loadU64fast(sAddr) {
  if ((sAddr & 7) == 0 && sAddr < -2139095040) {
    const phys = (sAddr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
    return ramDV.getBigUint64(phys, false);
  }
  return loadU64slow(sAddr >>> 0);
}

export function store8fast(sAddr, value) {
  if (sAddr < -2139095040) {
    const phys = (sAddr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
    ramDV.setUint8(phys, value, false);
    return;
  }
  store8slow(sAddr >>> 0, value);
}

export function store16fast(sAddr, value) {
  if ((sAddr & 1) == 0 && sAddr < -2139095040) {
    const phys = (sAddr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
    ramDV.setUint16(phys, value, false);
    return;
  }
  store16slow(sAddr >>> 0, value);
}

export function store32fast(sAddr, value) {
  if ((sAddr & 3) == 0 && sAddr < -2139095040) {
    const phys = (sAddr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
    ramDV.setUint32(phys, value, false);
    return
  }
  store32slow(sAddr >>> 0, value);
}

export function store64fast(sAddr, value) {
  if ((sAddr & 7) == 0 && sAddr < -2139095040) {
    const phys = (sAddr + 0x80000000) | 0;  // NB: or with zero ensures we return an SMI if possible.
    ramDV.setBigUint64(phys, value, false);
    return;
  }
  store64slow(sAddr >>> 0, value);
}
