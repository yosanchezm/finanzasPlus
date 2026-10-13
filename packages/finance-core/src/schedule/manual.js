import { ValidationError } from '../errors.js';
import { interestFor, makeRow } from './row.js';

/**
 * Manual system: the lender (or the family agreement) fixes each due date and
 * amount. Interest accrues on the balance at the periodic rate and the rest of
 * each planned amount is principal. The last row settles whatever remains, and
 * principal never exceeds the balance.
 * @param {{ terms: object, balance: number, i: number, unit: number, dates: string[], fromPeriod: number }} ctx
 * @returns {object[]} ScheduleRow[]
 */
export function buildManual({ terms, balance, i, unit, dates, fromPeriod }) {
  const planned = terms.manualPlan.slice(fromPeriod - 1);
  const rows = [];
  let opening = balance;
  for (let index = 0; index < dates.length; index += 1) {
    const interest = interestFor(opening, i, unit);
    const amount = planned[index][1];
    let principal = opening;
    if (index < dates.length - 1) {
      if (amount < interest) {
        throw new ValidationError(
          'manual_plan_below_interest',
          `planned amount ${amount} for ${dates[index]} does not cover the ${interest} of accrued interest`,
        );
      }
      principal = Math.min(amount - interest, opening);
    }
    rows.push(makeRow(fromPeriod + index, dates[index], opening, interest, principal));
    opening -= principal;
  }
  return rows;
}
