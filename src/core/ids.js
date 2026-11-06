// Opaque, stable identifiers (spec §9, design D9).

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

export function newId(prefix) {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += ID_ALPHABET[b & 31];
  return `${prefix}-${s}`;
}
