import { Device } from './device.js';

// RDRAM Interface
const RI_MODE_REG = 0x00;
const RI_CONFIG_REG = 0x04;
const RI_CURRENT_LOAD_REG = 0x08;
const RI_SELECT_REG = 0x0C;
const RI_REFRESH_REG = 0x10;
const RI_COUNT_REG = RI_REFRESH_REG;
const RI_LATENCY_REG = 0x14;
const RI_RERROR_REG = 0x18;
const RI_WERROR_REG = 0x1C;
const RI_LAST_REG = RI_WERROR_REG;


export class RIRegDevice extends Device {
    constructor(hardware, rangeStart, rangeEnd) {
        super("RIReg", hardware, hardware.ri_reg, rangeStart, rangeEnd);
    }

    reset() {
        // This skips most of init
        this.mem.set32(RI_SELECT_REG, 1);
    }
}
