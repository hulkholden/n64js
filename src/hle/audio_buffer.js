// RSP DMA and vector loops round their byte counts up to these boundaries.
export const round8 = n => (n + 7) & ~7;
export const round16 = n => (n + 15) & ~15;
export const round32 = n => (n + 31) & ~31;
