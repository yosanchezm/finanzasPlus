// Deterministic budget line ids (AD4). FNV-1a 64-bit over the UTF-8 bytes, computed with 16-bit limbs
// on Numbers so no BigInt literal is needed (Node 16 scan, any Vite target). Pure.

const OFFSET = [0x2325, 0x8422, 0x9ce4, 0xcbf2]; // 0xcbf29ce484222325, least significant limb first
const PRIME = [0x01b3, 0x0000, 0x0100, 0x0000]; // 0x00000100000001b3
const LIMB = 0x10000;

function multiplyByPrime(limbs) {
  const out = [0, 0, 0, 0];
  let carry = 0;
  for (let k = 0; k < 4; k += 1) {
    let sum = carry;
    for (let i = 0; i <= k; i += 1) sum += limbs[i] * PRIME[k - i];
    out[k] = sum % LIMB;
    carry = Math.floor(sum / LIMB);
  }
  return out;
}

/** FNV-1a 64-bit of the UTF-8 bytes of `text`, as 16 lowercase hex digits. */
export function fnv1a64hex(text) {
  let limbs = OFFSET.slice();
  for (const byte of new TextEncoder().encode(String(text))) {
    limbs[0] ^= byte;
    limbs = multiplyByPrime(limbs);
  }
  return limbs.map((limb) => limb.toString(16).padStart(4, '0')).reverse().join('');
}

/** Hash input of a target: `category:{id}` or `group:{group}`. */
export const targetKey = ({ targetType, targetId }) => `${targetType}:${targetId}`;

const monthDigits = (month) => month.replace('-', '');
const hashed = (prefix) => (target, month) => `${prefix}${monthDigits(month)}${fnv1a64hex(targetKey(target))}`;

/** Ids by origin: one-month override `bo`, recurring from a month `br`, seeded plan `bs`, migrated `bl{budgetId}`. */
export const lineIds = {
  override: hashed('bo'),
  recurring: hashed('br'),
  seeded: hashed('bs'),
  migrated: (budgetId) => `bl${budgetId}`,
};
