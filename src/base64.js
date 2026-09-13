export function encodeArray(bytes) {
  return bytes.toBase64();
}

export function decodeArray(base64) {
  return Uint8Array.fromBase64(base64);
}
