import { monthOutflows } from '@finance-core';
import { monthKeyOf } from './dates';

/**
 * Income and outflow per month key (AD11), delegated to `monthOutflows` so the dashboard shares the budget's
 * classifier and debt rule. Each row keeps the group split (`consumption`, `saving`, `investment`, `debt`) and
 * `outflow`; `expenses` is the outflow (the series the charts plot against income), so income - expenses is Balance.
 * Months without transactions are zero. Transfers are ignored.
 */
export const aggregateMonthlyTotals = (transactions = [], monthKeys = [], { categoriesById = new Map(), debts = [], debtEvents = null, inScope = () => true } = {}) =>
  monthOutflows(transactions, debtEvents, debts, monthKeys, categoriesById, { inScope, monthOf: (item) => monthKeyOf(item.occurredAt) })
    .map((row) => ({ ...row, expenses: row.outflow }));

/** Change against the previous value. `percent` is null when the previous value is zero. */
export const computeDelta = (current, previous) => {
  const difference = Number(current || 0) - Number(previous || 0);
  return { difference, percent: previous ? (difference / Math.abs(previous)) * 100 : null };
};
