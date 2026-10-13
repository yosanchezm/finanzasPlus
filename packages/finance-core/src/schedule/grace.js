import { interestFor, makeRow } from './row.js';

/**
 * Builds the grace rows at the head of a schedule (periods 1..`grace.periods`,
 * counted on absolute period numbers so rebuilt tails stay consistent).
 * - `total`: interest is not paid, it capitalizes. The row carries the accrued
 *   interest, a negative principal equal to it and a zero installment.
 * - `principal`: interest is paid, no principal is amortized.
 * Rows are always listed, even at 0%.
 * @param {{ terms: object, i: number, unit: number, balance: number, fromPeriod: number, dates: string[] }} ctx
 * @returns {{ rows: object[], balance: number, consumed: number }} the rows, the balance
 *   after grace and how many of `dates` they used.
 */
export function buildGraceRows({ terms, i, unit, balance, fromPeriod, dates }) {
  const rows = [];
  const lastGracePeriod = terms.grace ? terms.grace.periods : 0;
  let opening = balance;
  let consumed = 0;
  while (consumed < dates.length && fromPeriod + consumed <= lastGracePeriod) {
    const interest = interestFor(opening, i, unit);
    const principal = terms.grace.type === 'total' ? -interest : 0;
    rows.push(makeRow(fromPeriod + consumed, dates[consumed], opening, interest, principal));
    opening -= principal;
    consumed += 1;
  }
  return { rows, balance: opening, consumed };
}
