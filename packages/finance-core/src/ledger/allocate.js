import { ValidationError } from '../errors.js';
import { assertMinor } from '../money.js';

/** Payment buckets in the default order: charges, taxes, late interest, current interest, principal. */
export const BUCKETS = Object.freeze(['charges', 'taxes', 'lateInterest', 'interest', 'principal']);

/** @returns {{ charges: number, taxes: number, lateInterest: number, interest: number, principal: number }} */
export const emptyBuckets = () => ({ charges: 0, taxes: 0, lateInterest: 0, interest: 0, principal: 0 });

function readBuckets(buckets, label) {
  const result = emptyBuckets();
  for (const key of BUCKETS) {
    const value = buckets?.[key] ?? 0;
    if (assertMinor(value, `${label}.${key}`) < 0) {
      throw new ValidationError('invalid_minor', `${label}.${key} must be >= 0, got ${value}`);
    }
    result[key] = value;
  }
  return result;
}

function fullOrder(order) {
  if (order === undefined) return BUCKETS;
  const known = Array.isArray(order) && order.every((key, index) => BUCKETS.includes(key) && order.indexOf(key) === index);
  if (!known) throw new ValidationError('invalid_allocation_order', `allocationOrder must list distinct buckets among ${BUCKETS.join(', ')}`);
  return order.concat(BUCKETS.filter((key) => !order.includes(key)));
}

/**
 * Splits a payment over the buckets that are due, following `order`. A bucket
 * receives money only after the earlier ones are covered, so a short payment
 * never reduces principal before charges and interest (DL-3). Buckets missing
 * from `order` follow in the default order.
 * @param {number} amountMinor Whole pesos >= 0.
 * @param {Partial<Record<'charges'|'taxes'|'lateInterest'|'interest'|'principal', number>>} due What is owed per bucket.
 * @param {string[]} [order] Defaults to {@link BUCKETS}.
 * @returns {{ charges: number, taxes: number, lateInterest: number, interest: number, principal: number, surplus: number }}
 *   `surplus` is whatever exceeds everything due; the buckets plus the surplus add up to the amount.
 */
export function allocate(amountMinor, due, order) {
  if (assertMinor(amountMinor, 'amountMinor') < 0) throw new ValidationError('invalid_minor', `amountMinor must be >= 0, got ${amountMinor}`);
  const owed = readBuckets(due, 'due');
  const result = emptyBuckets();
  let remaining = amountMinor;
  for (const key of fullOrder(order)) {
    result[key] = Math.min(remaining, owed[key]);
    remaining -= result[key];
  }
  return { ...result, surplus: remaining };
}

/**
 * Applies a split stated by the bank: each bucket takes what the bank said,
 * capped at what is due, regardless of the allocation order.
 * @param {object} split Per-bucket amounts >= 0.
 * @param {object} due What is owed per bucket.
 * @returns {{ taken: object, left: object }} `left` is what did not fit and can go to the next installment.
 */
export function allocateSplit(split, due) {
  const stated = readBuckets(split, 'split');
  const owed = readBuckets(due, 'due');
  const taken = emptyBuckets();
  const left = emptyBuckets();
  for (const key of BUCKETS) {
    taken[key] = Math.min(stated[key], owed[key]);
    left[key] = stated[key] - taken[key];
  }
  return { taken, left };
}
