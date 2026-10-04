// Cache physical TMEM snapshots shared by both texture slots. The default
// budget holds 16 MiB of texels, allocated on demand. Hash matches are trusted;
// only the current snapshot has a CPU copy, to skip hashing unchanged draws.
export class TMEMTexture {
  constructor(gl, maxEntries = 4096) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError('TMEM cache must hold at least one snapshot');
    }
    this.gl = gl;
    this.maxEntries = maxEntries;
    this.entries = new Map();
    this.texture = null;
    this.words = new Int32Array(1024);
    // Count changed-snapshot lookups; unchanged draws bypass the cache.
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  bind(tmem, slot = 2) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + slot);
    if (this.texture && this.matches(tmem.tmemData32)) {
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      return;
    }

    const hash = tmem.hashContents();
    let texture = this.entries.get(hash);
    if (texture) {
      // Map iteration order is the LRU order. The current snapshot remains
      // newest during unchanged draws, so those need no cache bookkeeping.
      this.entries.delete(hash);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      this.hits++;
    } else {
      this.misses++;
      if (this.entries.size < this.maxEntries) {
        texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, 64, 64, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, tmem.tmemData);
      } else {
        const oldest = this.entries.keys().next().value;
        texture = this.entries.get(oldest);
        this.entries.delete(oldest);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 64, gl.RED_INTEGER, gl.UNSIGNED_BYTE, tmem.tmemData);
        this.evictions++;
      }
    }
    this.entries.set(hash, texture);
    this.texture = texture;
    this.words.set(tmem.tmemData32);
  }

  matches(words) {
    for (let i = 0; i < this.words.length; i++) {
      if (this.words[i] !== words[i]) return false;
    }
    return true;
  }

  reset() {
    for (const texture of this.entries.values()) this.gl.deleteTexture(texture);
    this.entries.clear();
    this.texture = null;
    this.hits = this.misses = this.evictions = 0;
  }
}
