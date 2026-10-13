import { interestFor, makeRow } from './row.js';

/**
 * Bullet system (single payment at maturity): interest accrues and capitalizes
 * in every period but the last, which pays the whole balance. Capitalizing rows
 * have a negative principal equal to their interest and a zero installment.
 * @param {{ balance: number, i: number, unit: number, dates: string[], fromPeriod: number }} ctx
 * @returns {object[]} ScheduleRow[]
 */
export function buildBullet({ balance, i, unit, dates, fromPeriod }) {
  const rows = [];
  let opening = balance;
  for (let index = 0; index < dates.length; index += 1) {
    const interest = interestFor(opening, i, unit);
    const principal = index === dates.length - 1 ? opening : -interest;
    rows.push(makeRow(fromPeriod + index, dates[index], opening, interest, principal));
    opening -= principal;
  }
  return rows;
}
