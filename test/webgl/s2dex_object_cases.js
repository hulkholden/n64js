// RDP rectangle parameters emitted by S2DEX 1.07 (Nushi Zuri 64) and
// S2DEX xbus 2.06 (Command & Conquer) for synthetic 8x4 RGBA16 sprites.
// Both microcodes produced identical packets. No game display lists or ROM
// bytes are included.
export const s2dexObjectCases = [
  {"options":{"mode":0},"rect":[10,20,18,24,0,0,1,1]},
  {"options":{"mode":1},"rect":[10,20,18,24,0,0,1,1]},
  {"options":{"mode":2},"rect":[10,20,18,24,0,0,1,1]},
  {"options":{"mode":4},"rect":[10,20,18,24,0,0,1,1]},
  {"options":{"mode":8},"rect":[9.5,19.5,17.5,23.5,-0.5,-1,1,1]},
  {"options":{"mode":16},"rect":[10,20,17,23,0.5,0.5,1,1]},
  {"options":{"mode":32},"rect":[10,20,16,22,1,1,1,1]},
  {"options":{"mode":64},"rect":[10,20,18.25,24.25,0,0,1,1]},
  {"options":{"mode":24},"rect":[10,20,17,23,0,0,1,1]},
  {"options":{"mode":40},"rect":[9.5,19.5,15.5,21.5,0.5,0,1,1]},
  {"options":{"mode":72},"rect":[9.5,19.5,17.75,23.75,-0.5,-1,1,1]},
  {"options":{"flags":1,"mode":0},"rect":[10,20,18,24,7.96875,0,-1,1]},
  {"options":{"flags":1,"mode":8},"rect":[9.5,19.5,17.5,23.5,7.46875,-1,-1,1]},
  {"options":{"flags":1,"mode":24},"rect":[10,20,17,23,6.96875,0,-1,1]},
  {"options":{"flags":1,"mode":64},"rect":[10,20,18.25,24.25,8.34375,0,-1,1]},
  {"options":{"flags":16,"mode":0},"rect":[10,20,18,24,0,3.96875,1,-1]},
  {"options":{"flags":16,"mode":8},"rect":[9.5,19.5,17.5,23.5,-0.5,3.96875,1,-1]},
  {"options":{"flags":16,"mode":24},"rect":[10,20,17,23,0,2.96875,1,-1]},
  {"options":{"flags":16,"mode":64},"rect":[10,20,18.25,24.25,0,4.34375,1,-1]},
  {"options":{"flags":17,"mode":0},"rect":[10,20,18,24,7.96875,3.96875,-1,-1]},
  {"options":{"flags":17,"mode":8},"rect":[9.5,19.5,17.5,23.5,7.46875,3.96875,-1,-1]},
  {"options":{"flags":17,"mode":24},"rect":[10,20,17,23,6.96875,2.96875,-1,-1]},
  {"options":{"flags":17,"mode":64},"rect":[10,20,18.25,24.25,8.34375,4.34375,-1,-1]},
  {"options":{"mode":0,"scale":2,"x":10.25,"y":20.75},"rect":[10,21,14,23,0,0,2,2]},
  {"options":{"mode":8,"scale":2,"x":10.25,"y":20.75},"rect":[9.75,20.25,13.75,22.25,-0.5,-1,2,2]},
  {"options":{"mode":24,"scale":2,"x":10.25,"y":20.75},"rect":[10.25,20.75,13.75,22.25,0,-1.5,2,2]},
  {"options":{"mode":0,"partial":true,"matrix":{"sx":2,"sy":0.5,"x":5,"y":5}},"rect":[10,45,14,53,0,0,2,0.5]},
  {"options":{"mode":8,"partial":true,"matrix":{"sx":2,"sy":0.5,"x":5,"y":5}},"rect":[9.5,44.5,13.5,52.5,-0.5,-0.75,2,0.5]},
  {"options":{"mode":24,"partial":true,"matrix":{"sx":2,"sy":0.5,"x":5,"y":5}},"rect":[10,45,13.5,51,0,0,2,0.5]},
  {"options":{"copy":true},"rect":[10,20,18,24,0,0,1,1]},
  {"options":{"copy":true,"flags":17},"rect":[10,20,18,24,7.96875,3.96875,-1,-1]},
];

// Write the SDK's uObjSprite/uObjMtx records and dispatch the real commands.
export function drawS2DEXObject({ ram, state, microcode }, options = {}) {
  const { mode = 0, flags = 0, scale = 1, x = 10, y = 20, width = 8, height = 4,
    partial = false, rot = false, matrix = null } = options;
  const gbi1 = microcode.constructor.name === 'GBI1SDEX';
  const sprite = 0x100;
  ram.setInt16(sprite, x * 4);
  ram.setUint16(sprite + 2, scale * 1024);
  ram.setUint16(sprite + 4, width * 32);
  ram.setInt16(sprite + 8, y * 4);
  ram.setUint16(sprite + 10, scale * 1024);
  ram.setUint16(sprite + 12, height * 32);
  ram.setUint16(sprite + 16, 2);
  ram.setUint16(sprite + 18, 0);
  ram.setUint8(sprite + 20, 0);
  ram.setUint8(sprite + 21, 2);
  ram.setUint8(sprite + 22, 0);
  ram.setUint8(sprite + 23, flags);
  if (matrix) {
    const { a = 1, b = 0, c = 0, d = 1, x = 0, y = 0, sx = 1, sy = 1 } = matrix;
    [a, b, c, d].forEach((v, i) => ram.setInt32(0x180 + i * 4, v * 65536));
    ram.setInt16(0x190, x * 4);
    ram.setInt16(0x192, y * 4);
    ram.setUint16(0x194, sx * 1024);
    ram.setUint16(0x196, sy * 1024);
    microcode.getHandler(gbi1 ? 0x05 : 0xdc)(gbi1 ? 0x05170000 : 0xdc170000, 0x180);
  }
  const renderMode = gbi1 ? 0xb1 : 0x0b;
  microcode.getHandler(renderMode)(renderMode << 24, mode);
  state.rdpOtherModeH = options.copy ? 0x200000 : (mode & 8) ? 0x2000 : 0;
  const opcode = gbi1 ? (rot ? 0x04 : partial ? 0xb2 : 0x03) : (rot ? 0x02 : partial ? 0xda : 0x01);
  microcode.getHandler(opcode)(opcode << 24, sprite);
}
