

  // MIPS Interface
  export const MI_MODE_REG         = 0x00;
  export const MI_VERSION_REG      = 0x04;
  export const MI_INTR_REG         = 0x08;
  export const MI_INTR_MASK_REG    = 0x0C;

  export const MI_CLR_INIT         = 0x0080;
  export const MI_SET_INIT         = 0x0100;
  export const MI_CLR_EBUS         = 0x0200;
  export const MI_SET_EBUS         = 0x0400;
  export const MI_CLR_DP_INTR      = 0x0800;
  export const MI_CLR_RDRAM        = 0x1000;
  export const MI_SET_RDRAM        = 0x2000;

  export const MI_MODE_INIT        = 0x0080;
  export const MI_MODE_EBUS        = 0x0100;
  export const MI_MODE_RDRAM       = 0x0200;

  export const MI_INTR_MASK_CLR_SP = 0x0001;
  export const MI_INTR_MASK_SET_SP = 0x0002;
  export const MI_INTR_MASK_CLR_SI = 0x0004;
  export const MI_INTR_MASK_SET_SI = 0x0008;
  export const MI_INTR_MASK_CLR_AI = 0x0010;
  export const MI_INTR_MASK_SET_AI = 0x0020;
  export const MI_INTR_MASK_CLR_VI = 0x0040;
  export const MI_INTR_MASK_SET_VI = 0x0080;
  export const MI_INTR_MASK_CLR_PI = 0x0100;
  export const MI_INTR_MASK_SET_PI = 0x0200;
  export const MI_INTR_MASK_CLR_DP = 0x0400;
  export const MI_INTR_MASK_SET_DP = 0x0800;

  export const MI_INTR_MASK_SP   = 0x01;
  export const MI_INTR_MASK_SI   = 0x02;
  export const MI_INTR_MASK_AI   = 0x04;
  export const MI_INTR_MASK_VI   = 0x08;
  export const MI_INTR_MASK_PI   = 0x10;
  export const MI_INTR_MASK_DP   = 0x20;

  export const MI_INTR_SP        = 0x01;
  export const MI_INTR_SI        = 0x02;
  export const MI_INTR_AI        = 0x04;
  export const MI_INTR_VI        = 0x08;
  export const MI_INTR_PI        = 0x10;
  export const MI_INTR_DP        = 0x20;