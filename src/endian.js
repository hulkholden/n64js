
export function fixRomByteOrder(arrayBuffer) {
  const dataView = new DataView(arrayBuffer);

  switch (dataView.getUint32(0)) {
    case 0x80371240:
      // ok
      break;
    case 0x40123780:
      byteSwap(arrayBuffer, 3, 2, 1, 0);
      break;
    case 0x12408037:
      byteSwap(arrayBuffer, 2, 3, 0, 1);
      break;
    case 0x37804012:
      byteSwap(arrayBuffer, 1, 0, 3, 2);
      break;
    default:
      throw 'Unhandled byteswapping: ' + dataView.getUint32(0).toString(16);
  }
}

function byteSwap(buffer, i0, i1, i2, i3) {
  const u8 = new Uint8Array(buffer);
  for (let i = 0; i < u8.length; i += 4) {
    const a = u8[i + i0], b = u8[i + i1], c = u8[i + i2], d = u8[i + i3];
    u8[i + 0] = a;
    u8[i + 1] = b;
    u8[i + 2] = c;
    u8[i + 3] = d;
  }
}