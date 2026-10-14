import { roundUnit } from './money.js';

// Charges (insurance, fees, taxes) ride on top of an installment. They never
// touch principal amortization: they only add to what is due in the period.
//
// Evaluation order inside one period:
//   1. bases that need no other charge: fixed, pctOutstanding, pctOriginal, pctOfBase
//   2. pctOfCharge (for example IVA on a fee), looked up by `refId`
//   3. pctOfSubtotal (for example GMF): a percentage of everything the debtor
//      pays that period, that is the installment plus the charges from 1 and 2

const SUBTOTAL_BASIS = 'pctOfSubtotal';
const REFERENCE_BASIS = 'pctOfCharge';

function applies(charge, period, periodsPerYear) {
  const from = charge.fromPeriod ?? 1;
  const to = charge.toPeriod ?? Infinity;
  if (period < from || period > to) return false;
  if (charge.cadence === 'annual') return (period - from) % periodsPerYear === 0;
  if (charge.cadence === 'once') return period === from;
  return true;
}

function baseAmount(charge, ctx) {
  switch (charge.basis) {
    case 'fixed':
      return charge.value;
    case 'pctOutstanding':
      return roundUnit((ctx.openingMinor * charge.value) / 100, ctx.unit);
    case 'pctOriginal':
      return roundUnit((ctx.originalMinor * charge.value) / 100, ctx.unit);
    default:
      return roundUnit((charge.baseMinor * charge.value) / 100, ctx.unit);
  }
}

/**
 * Removes a charge together with every charge that references it through `pctOfCharge`,
 * transitively (an IVA on a fee goes with the fee). Pure: the input is not touched.
 * @param {object[]} charges Normalized charges (see `normalizeCharges`).
 * @param {string} id Id of the charge to remove; an unknown id removes nothing.
 * @returns {object[]} A new array with the remaining charges, in their order.
 */
export function removeCharge(charges, id) {
  const gone = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const charge of charges) {
      if (!gone.has(charge.id) && charge.basis === REFERENCE_BASIS && gone.has(charge.refId)) {
        gone.add(charge.id);
        grew = true;
      }
    }
  }
  return charges.filter((charge) => !gone.has(charge.id));
}

/**
 * Evaluates the charges that apply in one period.
 * @param {object[]} charges Normalized charges (see `validateTerms`).
 * @param {{ period: number, openingMinor: number, installmentMinor: number, originalMinor: number,
 *   periodsPerYear: number, unit: number }} ctx `period` is the absolute period number.
 * @returns {{ lines: Array<{ id: string, kind: string, label: string, display: string, amountMinor: number }>,
 *   chargesMinor: number, taxesMinor: number }} Lines keep the order of `charges`; zero amounts
 *   are omitted. Taxes (`kind: 'tax'`) are totalled apart from the other charges.
 */
export function evaluateCharges(charges, ctx) {
  const active = charges.filter((charge) => applies(charge, ctx.period, ctx.periodsPerYear));
  const amounts = new Map();
  let subtotal = ctx.installmentMinor;
  for (const charge of active) {
    if (charge.basis !== SUBTOTAL_BASIS && charge.basis !== REFERENCE_BASIS) {
      const amount = baseAmount(charge, ctx);
      amounts.set(charge.id, amount);
      subtotal += amount;
    }
  }
  for (const charge of active) {
    if (charge.basis === REFERENCE_BASIS) {
      const amount = roundUnit(((amounts.get(charge.refId) ?? 0) * charge.value) / 100, ctx.unit);
      amounts.set(charge.id, amount);
      subtotal += amount;
    }
  }
  for (const charge of active) {
    if (charge.basis === SUBTOTAL_BASIS) amounts.set(charge.id, roundUnit((subtotal * charge.value) / 100, ctx.unit));
  }

  const lines = [];
  let chargesMinor = 0;
  let taxesMinor = 0;
  for (const charge of active) {
    const amountMinor = amounts.get(charge.id);
    if (amountMinor === 0) continue;
    lines.push({ id: charge.id, kind: charge.kind, label: charge.label ?? charge.id, display: charge.display ?? 'itemized', amountMinor });
    if (charge.kind === 'tax') taxesMinor += amountMinor;
    else chargesMinor += amountMinor;
  }
  return { lines, chargesMinor, taxesMinor };
}
