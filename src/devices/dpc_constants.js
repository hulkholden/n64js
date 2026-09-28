// DPC register offsets.
export const DPC_START_REG = 0x00;
export const DPC_END_REG = 0x04;
export const DPC_CURRENT_REG = 0x08;
export const DPC_STATUS_REG = 0x0C;
export const DPC_CLOCK_REG = 0x10;
export const DPC_BUFBUSY_REG = 0x14;
export const DPC_PIPEBUSY_REG = 0x18;
export const DPC_TMEM_REG = 0x1C;

// Control bits written to DPC_STATUS_REG.
export const DPC_CLR_XBUS_DMEM_DMA = 0x0001;
export const DPC_SET_XBUS_DMEM_DMA = 0x0002;
export const DPC_CLR_FREEZE = 0x0004;
export const DPC_SET_FREEZE = 0x0008;
export const DPC_CLR_FLUSH = 0x0010;
export const DPC_SET_FLUSH = 0x0020;
export const DPC_CLR_TMEM_CTR = 0x0040;
export const DPC_CLR_PIPE_CTR = 0x0080;
export const DPC_CLR_CMD_CTR = 0x0100;
export const DPC_CLR_CLOCK_CTR = 0x0200;

// Bits returned by DPC_STATUS_REG.
export const DPC_STATUS_XBUS_DMEM_DMA = 0x001;
export const DPC_STATUS_FREEZE = 0x002;
export const DPC_STATUS_FLUSH = 0x004;
export const DPC_STATUS_START_GCLK = 0x008;
export const DPC_STATUS_TMEM_BUSY = 0x010;
export const DPC_STATUS_PIPE_BUSY = 0x020;
export const DPC_STATUS_CMD_BUSY = 0x040;
export const DPC_STATUS_CBUF_READY = 0x080;
export const DPC_STATUS_DMA_BUSY = 0x100;
export const DPC_STATUS_END_VALID = 0x200;
export const DPC_STATUS_START_VALID = 0x400;
