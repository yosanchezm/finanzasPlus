import { roundUnit } from '../money.js';
import { buildGraceRows } from './grace.js';
import { interestFor, makeRow } from './row.js';

/**
 * German system: constant principal share every period (after any grace) with
 * interest on the falling balance; the last row absorbs the rounding residue.
 * @param {{ terms: object, balance: number, i: number, unit: number, dates: string[], fromPeriod: number }} ctx
 * @returns {object[]} ScheduleRow[]
 */
export function buildGerman(ctx) {
  const { i, unit, dates, fromPeriod } = ctx;
  const grace = buildGraceRows(ctx);
  const count = dates.length - grace.consumed;
  const share = roundUnit(grace.balance / count, unit);
  const rows = grace.rows;
  let opening = grace.balance;
  for (let index = 0; index < count; index += 1) {
    const at = grace.consumed + index;
    const principal = index === count - 1 ? opening : Math.min(share, opening);
    rows.push(makeRow(fromPeriod + at, dates[at], opening, interestFor(opening, i, unit), principal));
    opening -= principal;
  }
  return rows;
}
