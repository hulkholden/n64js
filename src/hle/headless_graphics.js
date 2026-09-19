import { executeDisplayList } from './display_list.js';
import * as microcodes from './microcodes.js';
import { NullRenderer } from './null_renderer.js';
import { RSPState } from './rsp_state.js';

// Executes HLE graphics tasks without a framebuffer or browser debugger.
// Each hardware instance owns its state; RDP state can persist between tasks.
export class HeadlessGraphics {
  constructor(hardware) {
    this.hardware = hardware;
    this.reset();
  }

  reset() {
    this.state = new RSPState();
    this.renderer = new NullRenderer(this.state);
  }

  processTask(task) {
    const ramDV = this.hardware.cachedMemDevice.mem.dataView;
    this.renderer.onTextureUse = this.hardware.onTextureUse;
    this.state.reset(ramDV, task.dataPtr, () => this.hardware.miRegDevice.interruptDP());

    const dims = this.hardware.viRegDevice.computeDimensions();
    if (dims) {
      this.renderer.nativeTransform.initDimensions(dims.srcWidth, dims.srcHeight);
    }
    this.renderer.newFrame();

    const initMicrocode = () => {
      const microcode = microcodes.create(task, this.state, ramDV, this.hardware.onMicrocodeLoad);
      microcode.renderer = this.renderer;
      // Unwind the display list on a fatal HLE warning. CPU0.run reports the
      // exception through the headless environment's normal halt callback.
      microcode.hleHalt = message => { throw new Error(message); };
      return microcode;
    };

    return executeDisplayList(this.state, initMicrocode(), {
      loadMicrocode: (codeAddr, codeSize, codeDataAddr, codeDataSize) => {
        task.loadUcode(codeAddr, codeSize, codeDataAddr, codeDataSize);
        return initMicrocode();
      },
    });
  }
}
