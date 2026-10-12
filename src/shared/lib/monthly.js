import { monthKeyOf } from './dates';

/** Income and expense totals per month key; months without transactions are zero. */
export const aggregateMonthlyTotals = (transactions = [], monthKeys = []) => {
  const totals = new Map(monthKeys.map((month) => [month, { month, income: 0, expenses: 0 }]));
  transactions.forEach((item) => {
    const entry = totals.get(monthKeyOf(item.occurredAt));
    if (!entry) return;
    if (item.type === 'income') entry.income += Number(item.amountMinor || 0);
    else if (item.type === 'expense') entry.expenses += Number(item.amountMinor || 0);
  });
  return monthKeys.map((month) => totals.get(month));
};

/** Change against the previous value. `percent` is null when the previous value is zero. */
export const computeDelta = (current, previous) => {
  const difference = Number(current || 0) - Number(previous || 0);
  return { difference, percent: previous ? (difference / Math.abs(previous)) * 100 : null };
};
