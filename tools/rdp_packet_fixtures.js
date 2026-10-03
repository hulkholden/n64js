// Flat-top triangle: (0,0), (8,0), (0,8), with affine shade and inverse W.
// Coefficients are split into their integer and fractional halfwords in packets.
export function trianglePacket({ shade = true, texture = true, zbuffer = false, tile = 0 } = {}) {
  const words = [((8 | (shade ? 4 : 0) | (texture ? 2 : 0) | (zbuffer ? 1 : 0)) << 24) | (tile << 16) | 32,
    0, 8 << 16, -65536, 0, 0, 0, 0];
  function coeff(base, dx, de = [0, 0, 0, 0]) {
    const split = v => [((v[0] & 0xffff0000) | (v[1] >>> 16)), ((v[2] & 0xffff0000) | (v[3] >>> 16)),
      ((v[0] << 16) | (v[1] & 0xffff)), ((v[2] << 16) | (v[3] & 0xffff))];
    const b = split(base), x = split(dx), e = split(de);
    words.push(...b.slice(0, 2), ...x.slice(0, 2), ...b.slice(2), ...x.slice(2),
      ...e.slice(0, 2), ...e.slice(0, 2), ...e.slice(2), ...e.slice(2));
  }
  if (shade) {
    coeff([0, 0, 0, 255 << 16], [16 << 16, 0, 0, 0]);
  }
  if (texture) {
    coeff([0, 0, 16384 << 16, 0], [8 << 16, 0, -1024 << 16, 0]);
  }
  if (zbuffer) {
    words.push(0x40000000, 0, 0, 0);
  }
  return words;
}
