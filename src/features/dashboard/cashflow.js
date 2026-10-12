/**
 * Daily cumulative income and expenses for today's month, from day 1 up to today.
 * Only uses the transactions it receives; nothing is projected.
 */
export const buildCashflowSeries = (transactions = [], today = new Date()) => {
  const year = today.getFullYear();
  const month = today.getMonth();
  const lastDay = today.getDate();
  const income = Array(lastDay).fill(0);
  const expenses = Array(lastDay).fill(0);

  transactions.forEach((item) => {
    const date = new Date(item.occurredAt);
    if (Number.isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month) return;
    const index = date.getDate() - 1;
    if (index < 0 || index >= lastDay) return;
    (item.type === 'income' ? income : expenses)[index] += Number(item.amountMinor || 0);
  });

  let incomeTotal = 0;
  let expenseTotal = 0;
  return income.map((value, index) => {
    incomeTotal += value;
    expenseTotal += expenses[index];
    return { day: index + 1, income: incomeTotal, expenses: expenseTotal };
  });
};
