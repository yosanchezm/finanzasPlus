import { roundUnit } from '../money.js';
import { interestFor, makeRow } from './row.js';

/**
 * Level payment that amortizes `balance` over `count` periods at rate `i`.
 * @param {number} balance
 * @param {number} i Periodic rate as a fraction.
 * @param {number} count
 * @returns {number} Unrounded payment.
 */
export const levelPayment = (balance, i, count) => (i === 0 ? balance / count : (balance * i) / (1 - (1 + i) ** -count));

/**
 * French system: a fixed installment (principal + interest) every period; the
 * last row absorbs the rounding residue.
 * @param {{ balance: number, i: number, unit: number, dates: string[], fromPeriod: number }} ctx
 * @returns {object[]} ScheduleRow[]
 */
export function buildFrench({ balance, i, unit, dates, fromPeriod }) {
  const count = dates.length;
  const installment = roundUnit(levelPayment(balance, i, count), unit);
  const rows = [];
  let opening = balance;
  for (let index = 0; index < count; index += 1) {
    const interest = interestFor(opening, i, unit);
    const principal = index === count - 1 ? opening : Math.min(Math.max(installment - interest, 0), opening);
    rows.push(makeRow(fromPeriod + index, dates[index], opening, interest, principal));
    opening -= principal;
  }
  return rows;
}
