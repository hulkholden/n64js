export function encodeArray(bytes) {
  // Large saves (128 KiB FlashRAM) exceed browser function argument limits.
  const chunkSize = 0x8000;
  let binString = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binString += String.fromCodePoint(...bytes.subarray(i, i + chunkSize));
  }
  // Encode once so padding is only added at the end, not between chunks.
  return btoa(binString);
}

export function decodeArray(base64) {
  const binString = atob(base64);
  return Uint8Array.from(binString, m => m.codePointAt(0));
}
