
 // Serial Interface
 export const SI_DRAM_ADDR_REG      = 0x00;
 export const SI_PIF_ADDR_RD64B_REG = 0x04;
 export const SI_PIF_ADDR_WR64B_REG = 0x10;
 export const SI_STATUS_REG         = 0x18;

 export const SI_STATUS_DMA_BUSY    = 0x0001;
 export const SI_STATUS_RD_BUSY     = 0x0002;
 export const SI_STATUS_DMA_ERROR   = 0x0008;
 export const SI_STATUS_INTERRUPT   = 0x1000;