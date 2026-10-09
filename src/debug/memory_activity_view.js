import { MemoryActivity, pixelAddress } from './memory_activity.js';

const sourceNames = ['Untouched', 'CPU', 'PI DMA', 'SI DMA', 'SP DMA'];

export function installMemoryActivityView(hardware, gui) {
  let view = null;
  const options = { memoryActivity: false };
  const control = gui.add(options, 'memoryActivity').name('Memory activity (experimental)').onChange(enabled => {
    if (!enabled) {
      view?.dispose();
      view = null;
      hardware.memoryActivity = null;
      return;
    }
    try {
      view = new MemoryActivityView(hardware, () => control.setValue(false));
      hardware.memoryActivity = view.capture;
    } catch (error) {
      control.setValue(false);
      window.alert(`Unable to open memory activity: ${error.message}`);
    }
  });
}

export class MemoryActivityView {
  constructor(hardware, close) {
    this.capture = new MemoryActivity(hardware.ram.length);
    this.panel = document.createElement('section');
    this.panel.style.cssText = 'margin:16px;padding:16px;background:#151923;color:#e4e9f2;border:1px solid #526078;border-radius:8px;';
    this.panel.innerHTML = `
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        <strong>RAM activity · experimental</strong>
        <button data-action="pause">Freeze capture</button>
        <button data-action="reset">Clear</button>
        <label>Colour <select data-action="mode"><option value="0">Write source</option><option value="1">Write age</option></select></label>
        <label>Fade (VI frames) <input data-action="fade" type="number" min="1" max="36000" value="180" style="width:80px"></label>
        <label><input data-action="native" type="checkbox"> 1:1 pixels</label>
        <button data-action="close">Close</button>
      </div>
      <p style="margin:12px 0">Latest writer per byte · Morton layout ·
        <span style="color:#49b8ff">CPU</span> · <span style="color:#ffad42">PI DMA</span> ·
        <span style="color:#d883ff">SI DMA</span> · <span style="color:#4ce5ae">SP DMA</span> · black = untouched</p>
      <div data-action="viewport" style="overflow:auto;max-height:70vh;background:#080a0f"><canvas style="display:block;width:100%;image-rendering:pixelated"></canvas></div>
      <div data-action="status" style="margin-top:10px;font-family:monospace">Hover to inspect a physical RAM address. Aging follows emulated VI frames.</div>
      <small>CPU and PI/SI/SP writes only. Framebuffer and HLE writes are not tracked. Fit view samples bytes; use 1:1 to inspect every byte.</small>`;
    this.canvas = this.panel.querySelector('canvas');
    this.canvas.width = this.capture.width;
    this.canvas.height = this.capture.height;
    const gl = this.canvas.getContext('webgl2', { antialias: false, depth: false, alpha: false });
    if (!gl) {
      throw new Error('WebGL 2 is required');
    }
    this.gl = gl;
    this.textures = [];
    try {
      this.initGL();
    } catch (error) {
      this.dispose();
      throw error;
    }
    const element = action => this.panel.querySelector(`[data-action="${action}"]`);
    element('close').onclick = close;
    element('reset').onclick = () => this.capture.reset();
    element('pause').onclick = () => {
      this.capture.paused = !this.capture.paused;
      element('pause').textContent = this.capture.paused ? 'Resume capture' : 'Freeze capture';
    };
    element('native').onchange = event => {
      this.canvas.style.width = event.target.checked ? `${this.capture.width}px` : '100%';
      this.canvas.style.maxWidth = 'none';
    };
    this.fade = element('fade');
    this.mode = element('mode');
    this.status = element('status');
    this.canvas.onmousemove = event => {
      const rect = this.canvas.getBoundingClientRect();
      const x = Math.min(this.capture.width - 1, Math.floor((event.clientX - rect.left) * this.capture.width / rect.width));
      const y = Math.min(this.capture.height - 1, Math.floor((event.clientY - rect.top) * this.capture.height / rect.height));
      this.hoverAddress = pixelAddress(x, y);
    };
    document.querySelector('#display').parentElement.after(this.panel);
    this.draw = () => {
      this.render();
      this.animationFrame = requestAnimationFrame(this.draw);
    };
    this.draw();
  }

  initGL() {
    const gl = this.gl;
    const shaders = [];
    this.program = gl.createProgram();
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, `#version 300 es
        void main() {
          vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
          gl_Position = vec4(p * 2.0 - 1.0, 0, 1);
        }`], [gl.FRAGMENT_SHADER, `#version 300 es
        precision highp float;
        precision highp int;
        uniform highp usampler2D sources;
        uniform highp usampler2D times;
        uniform uint frame;
        uniform float fade;
        uniform int mode;
        out vec4 colour;
        void main() {
          ivec2 p = ivec2(int(gl_FragCoord.x), textureSize(sources, 0).y - 1 - int(gl_FragCoord.y));
          uint source = texelFetch(sources, p, 0).r;
          float age = clamp(float(frame - texelFetch(times, p, 0).r) / fade, 0.0, 1.0);
          vec3 c = source == 1u ? vec3(.286,.722,1) : source == 2u ? vec3(1,.678,.259) :
                   source == 3u ? vec3(.847,.514,1) : vec3(.298,.898,.682);
          // Retain source hues after aging; brightness still separates old writes.
          vec3 old = mix(vec3(dot(c, vec3(.2126,.7152,.0722))), c, .7) * .5;
          c = mode == 0 ? mix(c, old, age) : mix(vec3(1,.95,.5), vec3(.12,.18,.3), age);
          colour = vec4(source == 0u ? vec3(.015,.02,.03) : c, 1);
        }`]]) {
        const shader = gl.createShader(type);
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          throw new Error(gl.getShaderInfoLog(shader));
        }
        gl.attachShader(this.program, shader);
      }
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(this.program));
      }
    } finally {
      for (const shader of shaders) {
        gl.deleteShader(shader);
      }
    }
    gl.useProgram(this.program);
    for (const [unit, name, format] of [[0, 'sources', gl.R8UI], [1, 'times', gl.R32UI]]) {
      const texture = gl.createTexture();
      this.textures.push(texture);
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, format, this.capture.width, this.capture.height);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(this.program, name), unit);
    }
    this.uniforms = Object.fromEntries(['frame', 'fade', 'mode'].map(name => [name, gl.getUniformLocation(this.program, name)]));
  }

  render() {
    const gl = this.gl;
    const capture = this.capture;
    // Coalesce neighboring dirty rows into uploads, once per browser frame.
    const rows = [...capture.dirtyRows].sort((a, b) => a - b);
    for (let i = 0; i < rows.length;) {
      const first = rows[i++];
      let end = first + 1;
      while (i < rows.length && rows[i] === end) {
        end++;
        i++;
      }
      for (const [unit, data, type] of [[0, capture.sources, gl.UNSIGNED_BYTE], [1, capture.times, gl.UNSIGNED_INT]]) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, this.textures[unit]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, first, capture.width, end - first, gl.RED_INTEGER, type,
          data.subarray(first * capture.width, end * capture.width));
      }
    }
    capture.dirtyRows.clear();
    gl.uniform1ui(this.uniforms.frame, capture.frame);
    gl.uniform1f(this.uniforms.fade, Math.max(1, Number(this.fade.value) || 180));
    gl.uniform1i(this.uniforms.mode, Number(this.mode.value));
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (this.hoverAddress !== undefined) {
      const index = capture.index(this.hoverAddress);
      const source = capture.sources[index];
      this.status.textContent = `0x${this.hoverAddress.toString(16).padStart(8, '0')} · ${sourceNames[source] || 'Annotation'}${source ? ` · ${(capture.frame - capture.times[index]) >>> 0} VI frames ago` : ''}${capture.paused ? ' · capture frozen' : ''}`;
    }
  }

  dispose() {
    cancelAnimationFrame(this.animationFrame);
    for (const texture of this.textures) {
      this.gl.deleteTexture(texture);
    }
    this.gl.deleteProgram(this.program);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.panel.remove();
  }
}
