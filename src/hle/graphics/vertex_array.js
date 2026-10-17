const kPositionLocation = 0;
const kColorLocation = 1;
const kUVLocation = 2;

export const kVertexStrideFloats = 7;
export const kVertexStrideBytes = kVertexStrideFloats * Float32Array.BYTES_PER_ELEMENT;
const kMaxBatchVertices = 64 * 3;

export class VertexArray {
  constructor(gl) {
    this.gl = gl;
    this.vao = gl.createVertexArray();

    this.posBuffer = null;
    this.uvBuffer = null;
    this.colBuffer = null;
    this.interleavedBuffer = null;
    this.interleavedData = null;
    this.interleavedFloats = null;
    this.interleavedUints = null;
  }

  bind() {
    this.gl.bindVertexArray(this.vao);
  }

  unbind() {
    this.gl.bindVertexArray(null);
  }

  initInterleavedN64Attrs(maxVertices = kMaxBatchVertices) {
    const gl = this.gl;
    this.interleavedData = new ArrayBuffer(maxVertices * kVertexStrideBytes);
    this.interleavedFloats = new Float32Array(this.interleavedData);
    this.interleavedUints = new Uint32Array(this.interleavedData);

    const buffer = gl.createBuffer();
    this.interleavedBuffer = buffer;

    this.bind();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.interleavedData.byteLength, gl.DYNAMIC_DRAW);

    gl.enableVertexAttribArray(kPositionLocation);
    gl.vertexAttribPointer(kPositionLocation, 4, gl.FLOAT, false, kVertexStrideBytes, 0);

    gl.enableVertexAttribArray(kColorLocation);
    gl.vertexAttribPointer(kColorLocation, 4, gl.UNSIGNED_BYTE, true, kVertexStrideBytes, 16);

    gl.enableVertexAttribArray(kUVLocation);
    gl.vertexAttribPointer(kUVLocation, 2, gl.FLOAT, false, kVertexStrideBytes, 20);
    this.unbind();
  }

  setInterleavedData(positions, colours, coords, numVertices = positions.length >>> 2) {
    const gl = this.gl;
    if (numVertices * kVertexStrideFloats > this.interleavedFloats.length) {
      this.interleavedData = new ArrayBuffer(numVertices * kVertexStrideBytes);
      this.interleavedFloats = new Float32Array(this.interleavedData);
      this.interleavedUints = new Uint32Array(this.interleavedData);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.interleavedBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.interleavedData.byteLength, gl.DYNAMIC_DRAW);
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.interleavedBuffer);
    }

    const floats = this.interleavedFloats;
    const uints = this.interleavedUints;
    for (let i = 0; i < numVertices; i++) {
      const dst = i * kVertexStrideFloats;
      const posIdx = i * 4;
      const uvIdx = i * 2;
      floats[dst] = positions[posIdx];
      floats[dst + 1] = positions[posIdx + 1];
      floats[dst + 2] = positions[posIdx + 2];
      floats[dst + 3] = positions[posIdx + 3];
      uints[dst + 4] = colours[i];
      floats[dst + 5] = coords[uvIdx];
      floats[dst + 6] = coords[uvIdx + 1];
    }

    gl.bufferSubData(gl.ARRAY_BUFFER, 0, floats, 0, numVertices * kVertexStrideFloats);
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
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    // A combiner/blender variant may not consume shade or texture attributes.
    // Keep the upload buffer, but don't configure an inactive (-1) location.
    if (attrLoc >= 0) {
      gl.enableVertexAttribArray(attrLoc);
      gl.vertexAttribPointer(attrLoc, 4, gl.UNSIGNED_BYTE, true, 0, 0);
    }
    this.unbind();

    this.colBuffer = buffer;
  }

  initUVsAttr(program, attrName) {
    const gl = this.gl;
    this.bind();
    const attrLoc = gl.getAttribLocation(program, attrName);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    if (attrLoc >= 0) {
      gl.enableVertexAttribArray(attrLoc);
      gl.vertexAttribPointer(attrLoc, 2, gl.FLOAT, false, 0, 0);
    }
    this.unbind();

    this.uvBuffer = buffer;
  }

  setPosData(data, usage, length = 0) { this.setData(this.posBuffer, data, usage, length); }
  setColorData(data, usage, length = 0) { this.setData(this.colBuffer, data, usage, length); }
  setUVData(data, usage, length = 0) { this.setData(this.uvBuffer, data, usage, length); }

  // WebGL2 counts typed-array elements; length 0 uploads the entire array.
  setData(buffer, data, usage, length = 0) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage, 0, length);
  }
}
