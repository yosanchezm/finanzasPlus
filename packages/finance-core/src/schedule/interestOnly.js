import { roundUnit } from '../money.js';
import { interestFor, makeRow } from './row.js';

/**
 * Interest-only system with an optional balloon. Every period pays interest;
 * the last row repays the balloon (default: the whole balance). Any balance
 * above the balloon is amortized in equal shares over the earlier periods, and
 * the rounding residue lands in the penultimate row so the last principal is
 * exactly the balloon.
 * @param {{ terms: object, balance: number, i: number, unit: number, dates: string[], fromPeriod: number }} ctx
 * @returns {object[]} ScheduleRow[]
 */
export function buildInterestOnly({ terms, balance, i, unit, dates, fromPeriod }) {
  const count = dates.length;
  const balloon = Math.min(terms.balloonMinor ?? balance, balance);
  const share = count > 1 ? roundUnit((balance - balloon) / (count - 1), unit) : 0;
  const rows = [];
  let opening = balance;
  for (let index = 0; index < count; index += 1) {
    let principal;
    if (index === count - 1) principal = opening;
    else if (index === count - 2) principal = opening - balloon;
    else principal = Math.min(share, opening - balloon);
    rows.push(makeRow(fromPeriod + index, dates[index], opening, interestFor(opening, i, unit), principal));
    opening -= principal;
  }
  return rows;
}
