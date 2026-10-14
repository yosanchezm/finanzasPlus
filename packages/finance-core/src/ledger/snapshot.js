import { compareIso } from '../calendar.js';

/**
 * Summary of a projection as of a date, shared by the prepayment simulation and the plan
 * change preview so both read the same numbers (AD8). Pure: it only reads `projection`.
 * `installmentMinor`, `nextTotalMinor` and `nextDueOn` come from the first open row due after `on`; the
 * installment is interest plus principal, the total adds that row's charges and taxes (a card's minimum payment);
 * `remainingCostMinor` is every cost still to pay: interest, charges, taxes and mora.
 * @param {object} projection The result of `project()`.
 * @param {string} on `YYYY-MM-DD`.
 * @returns {{ balanceMinor: number, pastDueMinor: number, lateInterestMinor: number, installmentMinor: number,
 *   nextTotalMinor: number, nextDueOn: (string | null), remainingPeriods: number, lastDueOn: (string | null), remainingInterestMinor: number,
 *   remainingChargesMinor: number, remainingCostMinor: number }}
 */
export function snapshot(projection, on) {
  const open = projection.plan.filter((row) => row.outstandingMinor > 0);
  const next = open.find((row) => compareIso(row.dueOn, on) > 0);
  const { totals } = projection;
  const remainingInterestMinor = totals.remainingInterest;
  const remainingChargesMinor = totals.remainingCharges + totals.remainingTaxes;
  const lateInterestMinor = projection.lateInterestMinor ?? 0; // accrues from the mora engine on; 0 before it
  return {
    balanceMinor: projection.balanceMinor,
    pastDueMinor: projection.pastDueMinor,
    lateInterestMinor,
    installmentMinor: next ? next.installmentMinor : 0,
    nextTotalMinor: next ? next.totalDueMinor : 0,
    nextDueOn: next ? next.dueOn : null,
    remainingPeriods: projection.remainingPeriods,
    lastDueOn: open.length > 0 ? open[open.length - 1].dueOn : null,
    remainingInterestMinor,
    remainingChargesMinor,
    remainingCostMinor: remainingInterestMinor + remainingChargesMinor + lateInterestMinor,
  };
}
