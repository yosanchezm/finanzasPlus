import { roundUnit } from '../money.js';

// Shared by every amortization system so rounding follows one rule (AD5): each
// component of a period is rounded half away from zero to `terms.roundingUnit`,
// and the residue goes to the last installment so the closing balance is 0.

/**
 * Interest accrued over one period on `balance`, rounded to the unit.
 * @param {number} balance
 * @param {number} periodRate Fraction, for example 0.018 for 1.8 %.
 * @param {number} unit
 * @returns {number}
 */
export const interestFor = (balance, periodRate, unit) => roundUnit(balance * periodRate, unit);

/**
 * Builds a schedule row from its amortization figures. `principalMinor` is
 * negative when interest is capitalized (negative amortization), so that
 * `closing = opening - principal` and the principal column still sums to the
 * amount borrowed. Charge fields start empty and are filled by the charges step.
 * @param {number} period
 * @param {string} dueOn
 * @param {number} openingMinor
 * @param {number} interestMinor Interest accrued in the period.
 * @param {number} principalMinor
 * @returns {object} ScheduleRow
 */
export function makeRow(period, dueOn, openingMinor, interestMinor, principalMinor) {
  const installmentMinor = interestMinor + principalMinor;
  return {
    period,
    dueOn,
    openingMinor,
    interestMinor,
    principalMinor,
    charges: [],
    chargesMinor: 0,
    taxesMinor: 0,
    installmentMinor,
    totalDueMinor: installmentMinor,
    costMinor: interestMinor,
    closingMinor: openingMinor - principalMinor,
  };
}
