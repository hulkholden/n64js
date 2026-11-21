// Cache physical TMEM snapshots shared by both texture slots. The default
// budget holds 16 MiB of texels, allocated on demand. Hash matches are trusted;
// unchanged draws check tmem.version to skip hashing.
export class TMEMTexture {
  constructor(gl, maxEntries = 4096, glState = null) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError('TMEM cache must hold at least one snapshot');
    }
    this.gl = gl;
    this.glState = glState;
    this.maxEntries = maxEntries;
    this.entries = new Map();
    this.texture = null;
    this.tmemVersion = -1;
    // Count changed-snapshot lookups; unchanged draws bypass the cache.
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  bindTexture(texture) {
    if (this.glState) {
      this.glState.bindTexture0(texture);
    } else {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
    }
  }

  bind(tmem) {
    if (this.texture && this.tmemVersion === tmem.version) {
      this.bindTexture(this.texture);
      return;
    }

    const gl = this.gl;
    const hash = tmem.hashContents();
    let texture = this.entries.get(hash);
    if (texture) {
      this.bindTexture(texture);
      this.hits++;
      // Map iteration order is the LRU order. Defer Map delete+set promotion
      // until occupancy reaches half capacity to avoid V8 OrderedHashMap churn.
      if (this.entries.size >= (this.maxEntries >> 1) && texture !== this.texture) {
        this.entries.delete(hash);
        this.entries.set(hash, texture);
      }
      this.texture = texture;
      this.tmemVersion = tmem.version;
      return;
    }

    this.misses++;
    if (this.entries.size < this.maxEntries) {
      texture = gl.createTexture();
      this.bindTexture(texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, 64, 64, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, tmem.tmemData);
    } else {
      const oldest = this.entries.keys().next().value;
      texture = this.entries.get(oldest);
      this.entries.delete(oldest);
      this.bindTexture(texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 64, gl.RED_INTEGER, gl.UNSIGNED_BYTE, tmem.tmemData);
      this.evictions++;
    }
    this.entries.set(hash, texture);
    this.texture = texture;
    this.tmemVersion = tmem.version;
  }

  reset() {
    for (const texture of this.entries.values()) {
      this.gl.deleteTexture(texture);
    }
    this.entries.clear();
    this.texture = null;
    this.tmemVersion = -1;
    this.hits = this.misses = this.evictions = 0;
    this.glState?.invalidateTexture();
  }
}
