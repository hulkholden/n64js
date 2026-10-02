// A single physical TMEM snapshot shared by both texture slots. Comparing the
// 4 KiB contents also catches identical reloads and direct debugger edits.
export class TMEMTexture {
  constructor(gl) {
    this.gl = gl;
    this.texture = null;
    this.words = new Int32Array(1024);
  }

  bind(tmem, slot = 2) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + slot);
    if (!this.texture) {
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, 64, 64, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, tmem.tmemData);
      this.words.set(tmem.tmemData32);
      return;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    for (let i = 0; i < this.words.length; i++) {
      if (this.words[i] !== tmem.tmemData32[i]) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 64, gl.RED_INTEGER, gl.UNSIGNED_BYTE, tmem.tmemData);
        this.words.set(tmem.tmemData32);
        break;
      }
    }
  }

  reset() {
    if (this.texture) this.gl.deleteTexture(this.texture);
    this.texture = null;
  }
}
