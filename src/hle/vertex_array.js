
export class VertexArray {
  constructor(gl) {
    this.gl = gl;
    this.vao = gl.createVertexArray();

    this.posBuffer = null;
    this.uvBuffer = null;
    this.colBuffer = null;
  }

  bind() {
    this.gl.bindVertexArray(this.vao);
  }

  unbind() {
    this.gl.bindVertexArray(null);
  }

  initPosAttr(program, attrName) {
    const gl = this.gl;
    this.bind();
    const attrLoc = gl.getAttribLocation(program, attrName);
    const buffer = gl.createBuffer();
    gl.enableVertexAttribArray(attrLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.vertexAttribPointer(attrLoc, 4, gl.FLOAT, false, 0, 0);
    this.unbind();

    this.posBuffer = buffer;
  }

  initColorAttr(program, attrName) {
    const gl = this.gl;
    this.bind();
    const attrLoc = gl.getAttribLocation(program, attrName);
    const buffer = gl.createBuffer();
    gl.enableVertexAttribArray(attrLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.vertexAttribPointer(attrLoc, 4, gl.UNSIGNED_BYTE, true, 0, 0);
    this.unbind();

    this.colBuffer = buffer;
  }

  initUVsAttr(program, attrName) {
    const gl = this.gl;
    this.bind();
    const attrLoc = gl.getAttribLocation(program, attrName);
    const buffer = gl.createBuffer();
    gl.enableVertexAttribArray(attrLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.vertexAttribPointer(attrLoc, 2, gl.FLOAT, false, 0, 0);
    this.unbind();

    this.uvBuffer = buffer;
  }

  setPosData(data, usage) { this.setData(this.posBuffer, data, usage); }
  setColorData(data, usage) { this.setData(this.colBuffer, data, usage); }
  setUVData(data, usage) { this.setData(this.uvBuffer, data, usage); }

  setData(buffer, data, usage) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
  }
}
