import { computeBudgetMonth, linesFromLegacyBudgets } from '@finance-core';
import { addMonths, monthKey } from '../shared/lib/dates';
import { categoryColor } from '../shared/lib/categories';

const MISSING = { rows: [], status: 'missing' };

/**
 * Which lines the budget shows (AD15). `budget_lines` is the source once it exists and has data, or exists empty with no
 * legacy `budgets` rows (nothing to migrate). Missing, unavailable, or empty while `budgets` still has rows is 'legacy':
 * the lines come from the read-only `budgets` rows and editing stays off. Never throws.
 */
export function resolveBudgetLines({ budgetLines = MISSING, budgets = [] }) {
  const { rows = [], status = 'missing' } = budgetLines || MISSING;
  const legacy = status !== 'ok' || (rows.length === 0 && budgets.length > 0);
  return { linesMode: legacy ? 'legacy' : 'lines', linesStatus: status, lines: legacy ? linesFromLegacyBudgets(budgets) : rows };
}

export const canEditBudget = ({ scope, linesMode, linesStatus }) => scope === 'total' && linesMode === 'lines' && linesStatus === 'ok';

/**
 * The one budget computation of a month. `transactions` are the selected month only; `history` holds the earlier
 * months and only feeds the reference income. Debt events are null (unavailable) unless their table read was ok.
 */
export function buildBudgetMonth({ month, lines, categories, transactions, history = [], debts, debtEvents, inScope = () => true, scoped = false }) {
  const previousMonth = addMonths(month, -1);
  const previousMonthIncomeMinor = history
    .filter((item) => item.type === 'income' && inScope(item) && monthKey(new Date(item.occurredAt)) === previousMonth)
    .reduce((sum, item) => sum + Number(item.amountMinor || 0), 0);
  return computeBudgetMonth({
    month, lines, categories, transactions, previousMonthIncomeMinor, inScope, scoped,
    debts: debts?.rows ?? [],
    debtEvents: debtEvents?.status === 'ok' && debts?.status === 'ok' ? debtEvents.rows : null,
  });
}

/** Per-category rows (any group) with the month's limit and actual, as the dashboard donut reads them. */
export function dashboardCategoryStats(budgetMonth, categories) {
  const rows = new Map();
  for (const group of Object.values(budgetMonth.groups)) for (const row of group.categories) rows.set(row.categoryId, row);
  return categories.filter((category) => rows.has(category.$id)).map((category) => {
    const row = rows.get(category.$id);
    return { ...category, color: categoryColor(category), value: row.actualMinor, budget: row.plannedMinor };
  });
}
