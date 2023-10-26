export function encodeArray(bytes) {
  const binString = String.fromCodePoint(...bytes);
  return btoa(binString);
}

export function decodeArray(base64) {
  const binString = atob(base64);
  return Uint8Array.from(binString, m => m.codePointAt(0));
}
