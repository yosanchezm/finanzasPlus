import { getTransactionsInRange } from '../../appwrite';
import { addMonths, monthKeyOf, monthRange } from '../../shared/lib/dates';

const MONTHS = 3;

/**
 * Average monthly income and expense over the last 3 full months (the current month is excluded).
 * Unknown (`null`) when nothing was recorded, or no income: advice then says the cash flow is unknown
 * instead of guessing. `inScope(row)` limits the rows to the scope the user is viewing.
 * @param {object[]} rows Transactions with `type`, `amountMinor`, `occurredAt`, `ownerScope`.
 * @param {string} today YYYY-MM-DD.
 * @returns {({ avgIncomeMinor: number, avgExpenseMinor: number } | null)}
 */
export function averageCashflow(rows, today, inScope = () => true) {
  const current = today.slice(0, 7);
  const months = Array.from({ length: MONTHS }, (_, index) => addMonths(current, index - MONTHS));
  const counted = rows.filter((row) => months.includes(monthKeyOf(row.occurredAt)) && inScope(row));
  const total = (type) => counted.filter((row) => row.type === type).reduce((sum, row) => sum + Number(row.amountMinor || 0), 0);
  const income = total('income');
  if (income === 0) return null;
  return { avgIncomeMinor: Math.round(income / MONTHS), avgExpenseMinor: Math.round(total('expense') / MONTHS) };
}

/** Reads those 3 months through the data layer; any failure means "unknown" (`null`), never an error. */
export async function loadCashflow({ today, inScope }) {
  const current = today.slice(0, 7);
  try {
    const rows = await getTransactionsInRange(monthRange(addMonths(current, -MONTHS)).start, monthRange(current).start);
    return averageCashflow(rows, today, inScope);
  } catch {
    return null;
  }
}
