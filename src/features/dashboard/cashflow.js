import { classifyTransaction, debtPaymentEvents } from '@finance-core';

/**
 * Daily cumulative income and outflow (consumption, saving, investment and debt; AD11) for today's month, from day 1
 * up to today, so the last point's net is Balance. Transfers are ignored. `expenses` holds the outflow.
 * Debt follows the monthly rule: with readable `debtEvents`, active in-scope payments land on their effective day and cost
 * rows with a `debtId` are dropped; otherwise the cost rows stand in. Nothing is projected.
 */
export const buildCashflowSeries = (transactions = [], today = new Date(), { categoriesById = new Map(), debts = [], debtEvents = null, inScope = () => true } = {}) => {
  const year = today.getFullYear();
  const month = today.getMonth();
  const lastDay = today.getDate();
  const income = Array(lastDay).fill(0);
  const expenses = Array(lastDay).fill(0);

  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
  const payments = debtEvents == null ? null : debtPaymentEvents(monthKey, debts, debtEvents, inScope);
  (payments || []).forEach((event) => {
    const index = Number(event.effectiveOn.slice(8, 10)) - 1;
    if (index >= 0 && index < lastDay) expenses[index] += event.amountMinor;
  });

  transactions.forEach((item) => {
    const date = new Date(item.occurredAt);
    if (Number.isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month) return;
    const group = classifyTransaction(item, categoriesById);
    if (!group || (group === 'debt' && payments && item.debtId)) return;
    const index = date.getDate() - 1;
    if (index < 0 || index >= lastDay) return;
    (group === 'income' ? income : expenses)[index] += Number(item.amountMinor || 0);
  });

  let incomeTotal = 0;
  let expenseTotal = 0;
  return income.map((value, index) => {
    incomeTotal += value;
    expenseTotal += expenses[index];
    return { day: index + 1, income: incomeTotal, expenses: expenseTotal };
  });
};
