import { ValidationError } from '../errors.js';
import { roundUnit } from '../money.js';
import { buildGraceRows } from './grace.js';
import { interestFor, makeRow } from './row.js';

/**
 * Level payment that amortizes `balance` over `count` periods at rate `i`.
 * @param {number} balance
 * @param {number} i Periodic rate as a fraction.
 * @param {number} count
 * @returns {number} Unrounded payment.
 */
export const levelPayment = (balance, i, count) => (i === 0 ? balance / count : (balance * i) / (1 - (1 + i) ** -count));

// Keeps the installment and lets the term float: rows are generated until the
// balance is cleared, so the last installment is the smaller one.
function buildKeepingInstallment(ctx, grace) {
  const { i, unit, dates, fromPeriod, installment } = ctx;
  const rows = grace.rows;
  let opening = grace.balance;
  for (let at = grace.consumed; opening > 0; at += 1) {
    const interest = interestFor(opening, i, unit);
    if (installment <= interest || at >= dates.length) {
      throw new ValidationError('installment_too_low', `an installment of ${installment} cannot amortize a balance of ${opening} (period interest ${interest})`);
    }
    const principal = Math.min(installment - interest, opening);
    rows.push(makeRow(fromPeriod + at, dates[at], opening, interest, principal));
    opening -= principal;
  }
  return rows;
}

/**
 * French system: after any grace, a fixed installment (principal + interest)
 * every period; the last row absorbs the rounding residue. With
 * `ctx.installment` that installment is kept instead and the term floats.
 * @param {{ terms: object, balance: number, i: number, unit: number, dates: string[], fromPeriod: number, installment?: number }} ctx
 * @returns {object[]} ScheduleRow[]
 */
export function buildFrench(ctx) {
  const { i, unit, dates, fromPeriod } = ctx;
  const grace = buildGraceRows(ctx);
  if (ctx.installment !== undefined) return buildKeepingInstallment(ctx, grace);
  const count = dates.length - grace.consumed;
  const installment = roundUnit(levelPayment(grace.balance, i, count), unit);
  const rows = grace.rows;
  let opening = grace.balance;
  for (let index = 0; index < count; index += 1) {
    const at = grace.consumed + index;
    const interest = interestFor(opening, i, unit);
    const principal = index === count - 1 ? opening : Math.min(Math.max(installment - interest, 0), opening);
    rows.push(makeRow(fromPeriod + at, dates[at], opening, interest, principal));
    opening -= principal;
  }
  return rows;
}
