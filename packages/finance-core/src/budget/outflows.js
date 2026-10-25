import { debtPayments } from './compute.js';
import { classifyTransaction } from './groups.js';

// monthOutflows: income and outflow per month, so the dashboard net equals Balance (AD11). Node 16 safe.
// Same classifier and debt rule as computeBudgetMonth: payments replace cost rows that carry a debtId,
// the cost rows are the fallback when `debtEvents` is null or unreadable.

const monthOfTransaction = (tx) => String(tx.occurredAt || '').slice(0, 7);

/**
 * Per requested month `{month, income, consumption, saving, investment, debt, outflow}` in minor units.
 * `options.inScope` filters transactions and debts; `options.monthOf` overrides how a transaction maps to a month.
 */
export function monthOutflows(transactions = [], debtEvents = null, debts = [], months = [], categoriesById = new Map(), { inScope = () => true, monthOf = monthOfTransaction } = {}) {
  const rows = new Map(months.map((month) => [month, { month, income: 0, consumption: 0, saving: 0, investment: 0, debt: 0, outflow: 0 }]));
  const costRows = new Map(months.map((month) => [month, { withDebtId: 0, kindOnly: 0 }]));
  for (const tx of transactions.filter(inScope)) {
    const row = rows.get(monthOf(tx));
    const group = row && classifyTransaction(tx, categoriesById);
    if (!group) continue;
    const amount = tx.amountMinor;
    if (group === 'income') row.income += amount;
    else if (group === 'need' || group === 'want') row.consumption += amount;
    else if (group === 'debt') costRows.get(row.month)[tx.debtId ? 'withDebtId' : 'kindOnly'] += amount;
    else row[group] += amount;
  }
  return months.map((month) => {
    const row = rows.get(month);
    const costs = costRows.get(month);
    const payments = debtEvents == null ? null : debtPayments(month, debts, debtEvents, inScope);
    row.debt = payments == null ? costs.withDebtId + costs.kindOnly : costs.kindOnly + payments;
    row.outflow = row.consumption + row.saving + row.investment + row.debt;
    return row;
  });
}
