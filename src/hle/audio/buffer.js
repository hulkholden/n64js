// RSP DMA and vector loops round their byte counts up to these boundaries.
export const round8 = n => (n + 7) & ~7;
export const round16 = n => (n + 15) & ~15;
export const round32 = n => (n + 31) & ~31;
export const round2 = n => (n + 1) & ~1;
export const round64 = n => (n + 63) & ~63;
