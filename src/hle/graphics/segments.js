export function resolveSegmentAddress(segments, addr) {
  const segment = (addr >>> 24) & 0xf;
  // Add before masking so negative segment bases (e.g. Shadows of the Empire
  // relocations) wrap to the correct physical address.
  // TODO: this should probably mask against 0x00ff_ffff (same as SP_DRAM_ADDR_REG)
  // but that can result in out of bounds accesses in some DataViews (e.g. Wetrix)
  // which tries to load from 0x00f000ff. Really we should try to emulate SP DMA more accurately.
  return (segments[segment] + (addr & 0x00ffffff)) & 0x007fffff;
}
