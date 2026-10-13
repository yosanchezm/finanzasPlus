import { ValidationError } from './errors.js';

// Money is an integer count of pesos ("minor units"; COP has no cents in
// practice). Every component is rounded half away from zero (AD5).

/**
 * Asserts that `value` is a safe integer and returns it.
 * @param {unknown} value
 * @param {string} [label] Name of the field, used in the error message.
 * @returns {number}
 */
export function assertMinor(value, label = 'amount') {
  if (!Number.isSafeInteger(value)) {
    throw new ValidationError('invalid_minor', `${label} must be an integer number of pesos, got ${String(value)}`);
  }
  return value;
}

/**
 * Rounds to the nearest multiple of `unit`, with ties going away from zero
 * (2.5 -> 3, -2.5 -> -3). Never returns negative zero.
 * @param {number} value
 * @param {number} [unit] Rounding grid, 1 by default (whole pesos).
 * @returns {number}
 */
export function roundUnit(value, unit = 1) {
  if (!Number.isFinite(value)) {
    throw new ValidationError('invalid_number', `value must be a finite number, got ${String(value)}`);
  }
  if (!Number.isFinite(unit) || unit <= 0) {
    throw new ValidationError('invalid_unit', `rounding unit must be a positive number, got ${String(unit)}`);
  }
  const rounded = Math.sign(value) * Math.round(Math.abs(value) / unit) * unit;
  return rounded + 0; // turns -0 into 0
}

/**
 * Exact sum of integer amounts; an empty list sums to 0.
 * @param {number[]} amounts
 * @returns {number}
 */
export function sumMinor(amounts) {
  if (!Array.isArray(amounts)) {
    throw new ValidationError('invalid_list', 'sumMinor expects an array of integer amounts');
  }
  let total = 0;
  for (const amount of amounts) total += assertMinor(amount);
  return total;
}
