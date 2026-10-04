// Physical TMEM, byte ordered exactly as in the CPU loader. Addressing follows
// debug_texture.js; TLUT banks are selected per filter tap rather than decoded away.
// Reference: parallel-rdp/shaders/texture.h, sample_texel_* and sample_texture.
uniform highp usampler2D uTMEM;

// Match ImageFormat and ImageSize in gbi.js.
const int G_IM_FMT_RGBA = 0;
const int G_IM_FMT_YUV = 1;
const int G_IM_FMT_CI = 2;
const int G_IM_FMT_IA = 3;
const int G_IM_FMT_I = 4;

const int G_IM_SIZ_4b = 0;
const int G_IM_SIZ_8b = 1;
const int G_IM_SIZ_16b = 2;
const int G_IM_SIZ_32b = 3;

// TLUT modes are passed without the other-mode bit shift.
const int TLUT_NONE = 0;
const int TLUT_RGBA16 = 2;
const int TLUT_IA16 = 3;

int readTMEM8(int address) {
  address &= 4095;
  return int(texelFetch(uTMEM, ivec2(address & 63, address >> 6), 0).r);
}

int readTMEM16(int address) {
  return (readTMEM8(address) << 8) | readTMEM8(address + 1);
}

highp vec4 rgba16(int value) {
  ivec3 rgb = ivec3(value >> 11, value >> 6, value >> 1) & 31;
  rgb = (rgb << 3) | (rgb >> 2);
  return vec4(vec3(rgb), float((value & 1) * 255));
}

highp vec4 ia16(int value) {
  return vec4(vec3(float(value >> 8)), float(value & 255));
}

highp vec4 fetchTMEMTexel(ivec2 coord, TextureTile tile, int paletteBank) {
  int row = tile.memory.x + coord.y * tile.memory.y;
  int swizzle = (coord.y & 1) << 2;
  int format = tile.memory.z;
  int size = tile.memory.w;
  if (format == G_IM_FMT_YUV && size == G_IM_SIZ_16b) {
    int pair = ((row + (coord.x & ~1)) ^ swizzle) & 2047;
    int luma = (((row + coord.x) ^ swizzle) & 2047) | 2048;
    return vec4(float(readTMEM8(pair)), float(readTMEM8(pair + 1)), float(readTMEM8(luma)), 255.0);
  }
  if (format == G_IM_FMT_RGBA && size == G_IM_SIZ_32b) {
    int address = ((row + coord.x * 2) ^ swizzle) & 2047;
    return vec4(float(readTMEM8(address)), float(readTMEM8(address + 1)),
                float(readTMEM8(address | 2048)), float(readTMEM8((address | 2048) + 1)));
  }
  if (size == G_IM_SIZ_16b) {
    int value = readTMEM16(((row + coord.x * 2) ^ swizzle) & 4095);
    if (format == G_IM_FMT_RGBA) return rgba16(value);
    if (format == G_IM_FMT_IA) return ia16(value);
  }
  if (size <= G_IM_SIZ_8b) {
    int address = (row + (size == G_IM_SIZ_4b ? coord.x >> 1 : coord.x)) ^ swizzle;
    int value = readTMEM8(address & (tile.palette.y != TLUT_NONE ? 2047 : 4095));
    if (size == G_IM_SIZ_4b) value = (value >> ((1 - (coord.x & 1)) * 4)) & 15;
    if (tile.palette.y != TLUT_NONE) {
      int index = size == G_IM_SIZ_4b ? (tile.palette.x << 4) | value : value;
      int entry = readTMEM16(2048 + index * 8 + paletteBank * 2);
      return tile.palette.y == TLUT_IA16 ? ia16(entry) : rgba16(entry);
    }
    if (format == G_IM_FMT_IA) {
      if (size == G_IM_SIZ_4b) {
        int i = value >> 1;
        i = (i << 5) | (i << 2) | (i >> 1);
        return vec4(vec3(float(i)), float((value & 1) * 255));
      }
      return vec4(vec3(float((value >> 4) * 17)), float((value & 15) * 17));
    }
    if (format == G_IM_FMT_RGBA || format == G_IM_FMT_I) return vec4(float(size == G_IM_SIZ_4b ? value * 17 : value));
  }
  // Unsupported format/size combinations produce opaque black.
  return vec4(0.0, 0.0, 0.0, 255.0);
}
