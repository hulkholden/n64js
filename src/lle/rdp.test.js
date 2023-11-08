import { expect, test, describe, beforeEach } from "bun:test";
import * as rdp from "./rdp.js";

describe('Texture', () => {
  let triangle;
  beforeEach(function () {
    triangle = new rdp.Triangle();
  });

  describe('load tri1', () => {
    const commands = makeCommandDataView([
      0xce0001a9, 0x01a80028, 0x00000000, 0x03f6ff6c, 0x013fc000, 0x00000000, 0x00000000, 0x00000000,
      0x00c400cc, 0x00d800ff, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x006d005e, 0x00480000,
      0xfffefffe, 0xfffe0000, 0xfffefffe, 0xfffe0000, 0x2270621d, 0xc1a00000, 0x2270621d, 0xc1a00000,
      0x01a3059e, 0x3fff03fd, 0xfffffffd, 0x00000000, 0x350ab6c8, 0x7fc0d160, 0x67278613, 0x2ad00000,
      0xfff6ffee, 0xff5d0000, 0xfff6ffee, 0xff5d0000, 0x292ceb24, 0x70470154, 0x292ceb24, 0x70470154,
    ]);
    beforeEach(function () {
      const buf = new rdp.RDPBuffer(commands, 0, commands.byteLength, 0xffff_ffff);
      triangle.load(buf);
    });

    test('initialize members', () => {
      expect(triangle.type).toEqual(14);
      expect(triangle.tile).toEqual(0);
      expect(triangle.rightMajor).toEqual(false);
      expect(triangle.shade).toEqual(true);
      expect(triangle.texture).toEqual(true);
      expect(triangle.zbuffer).toEqual(false);

      expect(triangle.yh).toEqual(40);
      expect(triangle.ym).toEqual(424);
      expect(triangle.yl).toEqual(425);

      expect(triangle.xh).toEqual(0x13fc000);
      expect(triangle.xm).toEqual(0);
      expect(triangle.xl).toEqual(0);

      expect(triangle.dxhdy).toEqual(0);
      expect(triangle.dxmdy).toEqual(0);
      expect(triangle.dxldy).toEqual(0x3f6ff6c);
    });
    test('interpolateX', () => {
      expect(triangle.interpolateX(triangle.yh)).toEqual([0, 319]);
      expect(triangle.interpolateX(triangle.ym)).toEqual([0, 319]);
      expect(triangle.interpolateX(triangle.yl)).toEqual([1014, 319]);
    });
    test('calculateRectUVs', () => {
      const uvs = triangle.calculateRectUVs();
      expect(uvs).toHaveLength(8);
      expect(uvs[0]).toBeCloseTo(19.0532);
      expect(uvs[1]).toBeCloseTo(69.648);
      expect(uvs[2]).toBeCloseTo(13.1002);
      expect(uvs[3]).toBeCloseTo(44.9598);
      expect(uvs[4]).toBeCloseTo(-10.4642);
      expect(uvs[5]).toBeCloseTo(18.4035);
      expect(uvs[6]).toBeCloseTo(-16.4172);
      expect(uvs[7]).toBeCloseTo(-6.2846);
    });
  });

  describe('load tri2', () => {
    const commands = makeCommandDataView([
      0xce800397, 0x00280028, 0x013fc000, 0x00000000, 0x00000000, 0x0001747e, 0x00000000, 0x07550000,
      0x00ff00ff, 0x00ff00ff, 0x00000000, 0x00000000, 0x80008000, 0x80008000, 0x00000000, 0x00000000,
      0xffffffff, 0xffff0000, 0xffffffff, 0xffff0000, 0xefb1f206, 0xf5840000, 0xefb1f206, 0xf5840000,
      0x03ef0499, 0x3f7d0000, 0x0000fffe, 0x00000000, 0x8c14f430, 0x2b400000, 0x082ae7ea, 0x68580000,
      0xfffcfffc, 0xffdd0000, 0xfffcfffd, 0xffdc0000, 0xe2483af8, 0x420a0000, 0xd666d284, 0xaa360000,
    ]);
    beforeEach(function () {
      const buf = new rdp.RDPBuffer(commands, 0, commands.byteLength, 0xffff_ffff);
      triangle.load(buf);
    });

    test('initialize members', () => {
      expect(triangle.type).toEqual(14);
      expect(triangle.tile).toEqual(0);
      expect(triangle.rightMajor).toEqual(true);
      expect(triangle.shade).toEqual(true);
      expect(triangle.texture).toEqual(true);
      expect(triangle.zbuffer).toEqual(false);

      expect(triangle.yh).toEqual(40);
      expect(triangle.ym).toEqual(40);
      expect(triangle.yl).toEqual(919);

      expect(triangle.xh).toEqual(0);
      expect(triangle.xm).toEqual(0);
      expect(triangle.xl).toEqual(0x13fc000);

      expect(triangle.dxhdy).toEqual(0x1747e);
      expect(triangle.dxmdy).toEqual(0x7550000);
      expect(triangle.dxldy).toEqual(0);
    });
    test('interpolateX', () => {
      expect(triangle.interpolateX(triangle.yh)).toEqual([0, 319]);
      expect(triangle.interpolateX(triangle.ym)).toEqual([0, 319]);
      expect(triangle.interpolateX(triangle.yl)).toEqual([1278, 319]);
    });
    test('calculateRectUVs', () => {
      const uvs = triangle.calculateRectUVs();
      expect(uvs).toHaveLength(8);
      expect(uvs[0]).toBeCloseTo(31.4858);
      expect(uvs[1]).toBeCloseTo(36.8110);
      expect(uvs[2]).toBeCloseTo(31.8022);
      expect(uvs[3]).toBeCloseTo(25.9028);
      expect(uvs[4]).toBeCloseTo(31.4858);
      expect(uvs[5]).toBeCloseTo(36.8110);
      expect(uvs[6]).toBeCloseTo(31.8022);
      expect(uvs[7]).toBeCloseTo(25.9028);
    });
  });

  describe('load tri3', () => {
    const commands = makeCommandDataView([
      0xce800397, 0x03970028, 0x013fc000, 0xf8aa0000, 0x00000000, 0x00000000, 0x00000000, 0x0001747e,
      0x00ff00ff, 0x00ff00ff, 0x00000000, 0x00000000, 0x80008000, 0x80008000, 0x03330333, 0x02660000,
      0xffffffff, 0xffff0000, 0xffffffff, 0xffff0000, 0xeb08ed5d, 0xf2060000, 0xeb08ed5d, 0xf2060000,
      0x03f704a3, 0x3fff0000, 0x0000fffe, 0x00000000, 0xa0646650, 0x80000000, 0x083be5ab, 0x692f0000,
      0xfffcfffd, 0xffdc0000, 0xfffcfffd, 0xffdc0000, 0xcfe8ce0b, 0x61ac0000, 0xcfe8ce0b, 0x61ac0000,
    ]);
    beforeEach(function () {
      const buf = new rdp.RDPBuffer(commands, 0, commands.byteLength, 0xffff_ffff);
      triangle.load(buf);
    });

    test('initialize members', () => {
      expect(triangle.type).toEqual(14);
      expect(triangle.tile).toEqual(0);
      expect(triangle.rightMajor).toEqual(true);
      expect(triangle.shade).toEqual(true);
      expect(triangle.texture).toEqual(true);
      expect(triangle.zbuffer).toEqual(false);

      expect(triangle.yh).toEqual(40);
      expect(triangle.ym).toEqual(919);
      expect(triangle.yl).toEqual(919);

      expect(triangle.xh).toEqual(0);
      expect(triangle.xm).toEqual(0);
      expect(triangle.xl).toEqual(0x13fc000);

      expect(triangle.dxhdy).toEqual(0);
      expect(triangle.dxmdy).toEqual(0x1747e);
      expect(triangle.dxldy).toEqual(-0x7560000);
    });
    test('interpolateX', () => {
      expect(triangle.interpolateX(triangle.yh)).toEqual([0, 0]);
      expect(triangle.interpolateX(triangle.ym)).toEqual([0, 319]);
      expect(triangle.interpolateX(triangle.yl)).toEqual([0, 319]);
    });
    test('calculateRectUVs', () => {
      const uvs = triangle.calculateRectUVs();
      expect(uvs).toHaveLength(8);
      expect(uvs[0]).toBeCloseTo(31.7383);
      expect(uvs[1]).toBeCloseTo(37.1062);
      expect(uvs[2]).toBeCloseTo(32.0547);
      expect(uvs[3]).toBeCloseTo(26.1104);
      expect(uvs[4]).toBeCloseTo(9.8466);
      expect(uvs[5]).toBeCloseTo(22.0317);
      expect(uvs[6]).toBeCloseTo(10.1630);
      expect(uvs[7]).toBeCloseTo(11.0359);
    });
  });
});

function makeCommandDataView(commands) {
  const dv = new DataView(new ArrayBuffer(commands.length * 4));
  commands.forEach((value, index) => {
    dv.setUint32(index * 4, value, false);
  });
  return dv;
}