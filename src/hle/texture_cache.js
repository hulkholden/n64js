// Bound retained texture entries and their estimated RGBA pixel storage.
// The byte budget is per CPU/GPU copy, excluding driver and debug UI overhead.
export class TextureCache {
  constructor(gl, maxBytes = 32 * 1024 * 1024, maxEntries = 1024) {
    this.gl = gl;
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
    this.entries = new Map();
    this.byteLength = 0;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  get size() { return this.entries.size; }

  [Symbol.iterator]() { return this.entries[Symbol.iterator](); }

  // Support the renderer's existing has/get lookup as well as a single get.
  has(key) {
    const present = this.entries.has(key);
    if (!present) {
      this.misses++;
    }
    return present;
  }

  get(key) {
    const texture = this.entries.get(key);
    if (texture) {
      // Map iteration order is the LRU order.
      this.entries.delete(key);
      this.entries.set(key, texture);
      this.hits++;
    } else {
      this.misses++;
    }
    return texture;
  }

  set(key, texture) {
    if (!texture) {
      return;
    }
    if (this.entries.has(key)) {
      this.delete(key);
    }
    this.entries.set(key, texture);
    this.byteLength += texture.width * texture.height * 4;
    // At most 1024x1024 texels can be decoded, so the default budget always
    // fits both textures used by the current draw, even during insertion.
    while (this.byteLength > this.maxBytes || this.size > this.maxEntries) {
      this.delete(this.entries.keys().next().value);
      this.evictions++;
    }
  }

  delete(key) {
    const texture = this.entries.get(key);
    if (!texture) {
      return;
    }
    this.gl.deleteTexture(texture.texture);
    this.byteLength -= texture.width * texture.height * 4;
    this.entries.delete(key);
  }

  clear() {
    for (const key of this.entries.keys()) {
      this.delete(key);
    }
    this.hits = this.misses = this.evictions = 0;
  }
}
