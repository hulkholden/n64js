// The combined SP memory view stores DMEM first, followed by IMEM.
export const SP_DMEM_SIZE = 0x1000;
export const SP_IMEM_OFFSET = SP_DMEM_SIZE;

// SP register offsets.
export const SP_MEM_ADDR_REG = 0x00;
export const SP_DRAM_ADDR_REG = 0x04;
export const SP_RD_LEN_REG = 0x08;
export const SP_WR_LEN_REG = 0x0C;
export const SP_STATUS_REG = 0x10;
export const SP_DMA_FULL_REG = 0x14;
export const SP_DMA_BUSY_REG = 0x18;
export const SP_SEMAPHORE_REG = 0x1C;

// Control bits written to SP_STATUS_REG.
export const SP_CLR_HALT = 0x0000001;
export const SP_SET_HALT = 0x0000002;
export const SP_CLR_BROKE = 0x0000004;
export const SP_CLR_INTR = 0x0000008;
export const SP_SET_INTR = 0x0000010;
export const SP_CLR_SSTEP = 0x0000020;
export const SP_SET_SSTEP = 0x0000040;
export const SP_CLR_INTR_BREAK = 0x0000080;
export const SP_SET_INTR_BREAK = 0x0000100;
export const SP_CLR_SIG0 = 0x0000200;
export const SP_SET_SIG0 = 0x0000400;
export const SP_CLR_SIG1 = 0x0000800;
export const SP_SET_SIG1 = 0x0001000;
export const SP_CLR_SIG2 = 0x0002000;
export const SP_SET_SIG2 = 0x0004000;
export const SP_CLR_SIG3 = 0x0008000;
export const SP_SET_SIG3 = 0x0010000;
export const SP_CLR_SIG4 = 0x0020000;
export const SP_SET_SIG4 = 0x0040000;
export const SP_CLR_SIG5 = 0x0080000;
export const SP_SET_SIG5 = 0x0100000;
export const SP_CLR_SIG6 = 0x0200000;
export const SP_SET_SIG6 = 0x0400000;
export const SP_CLR_SIG7 = 0x0800000;
export const SP_SET_SIG7 = 0x1000000;

// Bits returned by SP_STATUS_REG.
export const SP_STATUS_HALT = 0x0001;
export const SP_STATUS_BROKE = 0x0002;
export const SP_STATUS_DMA_BUSY = 0x0004;
export const SP_STATUS_DMA_FULL = 0x0008;
export const SP_STATUS_IO_FULL = 0x0010;
export const SP_STATUS_SSTEP = 0x0020;
export const SP_STATUS_INTR_BREAK = 0x0040;
export const SP_STATUS_SIG0 = 0x0080;
export const SP_STATUS_SIG1 = 0x0100;
export const SP_STATUS_SIG2 = 0x0200;
export const SP_STATUS_SIG3 = 0x0400;
export const SP_STATUS_SIG4 = 0x0800;
export const SP_STATUS_SIG5 = 0x1000;
export const SP_STATUS_SIG6 = 0x2000;
export const SP_STATUS_SIG7 = 0x4000;

// Task-status aliases used by libultra.
export const SP_STATUS_YIELD = SP_STATUS_SIG0;
export const SP_STATUS_YIELDED = SP_STATUS_SIG1;
export const SP_STATUS_TASKDONE = SP_STATUS_SIG2;

// SP program-counter register offset.
export const SPIBIST_PC_REG = 0x00;
