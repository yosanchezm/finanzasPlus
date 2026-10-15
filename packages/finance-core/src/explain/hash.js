// FNV-1a, 32 bit, over the UTF-8 bytes of a text. It fingerprints the reviewed legal copy
// (see copy.js): any edit after the review changes the hash and un-reviews the entry.
// Pure, dependency-free, Node 16 and browser safe.

const OFFSET_BASIS = 0x811c9dc5;
const PRIME = 0x01000193;

/**
 * @param {string} text
 * @returns {string} Eight lowercase hexadecimal digits.
 */
export function fnv1a(text) {
  const bytes = new TextEncoder().encode(String(text));
  let hash = OFFSET_BASIS;
  for (let index = 0; index < bytes.length; index += 1) {
    hash = Math.imul(hash ^ bytes[index], PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
