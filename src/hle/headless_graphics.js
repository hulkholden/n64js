import { executeDisplayList } from './display_list.js';
import * as microcodes from './microcodes.js';
import { NullRenderer } from './null_renderer.js';
import { RDPGraphics } from './rdp_graphics.js';
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
    this.state.reset(this.hardware.ram.dataView, 0);
    this.rdp = new RDPGraphics(this.state, this.hardware.ram.dataView, this.renderer);
    this.rdp.hleHalt = message => { throw new Error(message); };
  }

  beginRDP() {
    this.renderer.onTextureUse = this.hardware.onTextureUse;
    this.renderer.onGraphicsMode = this.hardware.onGraphicsMode;
    const scanout = this.hardware.viRegDevice.computeScanout();
    if (scanout) {
      this.renderer.nativeTransform.initDimensions(scanout.renderWidth, scanout.renderHeight);
    }
    return this.rdp;
  }

  processTask(task) {
    const ramDV = this.hardware.cachedMemDevice.mem.dataView;
    this.renderer.onTextureUse = this.hardware.onTextureUse;
    this.renderer.onGraphicsMode = this.hardware.onGraphicsMode;
    this.state.reset(ramDV, task.dataPtr, () => this.hardware.dpcDevice.syncFullHLE());

    const scanout = this.hardware.viRegDevice.computeScanout();
    if (scanout) {
      this.renderer.nativeTransform.initDimensions(scanout.renderWidth, scanout.renderHeight);
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
