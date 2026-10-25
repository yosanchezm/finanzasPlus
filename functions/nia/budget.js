import { GROUPS, computeBudgetMonth, linesFromLegacyBudgets, planLineEdit } from '../../packages/finance-core/index.js';
import { isoDateIn, pesos } from './debt/format.js';

// Nia budget module (S8a, AD17): the snapshot inputs of a budget month, the "solo este mes" edit plan and the figures the
// replies quote. Pure and Node 16 safe: `listRows` is injected, nothing here talks to Appwrite. The wiring is S8b.

const T = { lines: 'budget_lines', legacy: 'budgets', categories: 'categories', transactions: 'transactions', debts: 'debts', events: 'debt_events' };
const DAY_MS = 86400000;
const BUDGET_GROUPS = GROUPS.filter((group) => group !== 'income');

export const LEGACY_REFUSAL = 'Los presupuestos todavía se están migrando, así que por ahora no puedo guardar cambios. Cuando se ejecuten `migrate:appwrite` y `migrate:budgets` podrás editarlos desde aquí.';

const monthStart = (month) => Date.parse(`${month}-01T00:00:00.000Z`);

function addMonths(month, amount) {
  const index = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + amount;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/**
 * The transaction range the budget month needs: M-1 (reference income) and M, widened by one day on each side so every
 * time zone offset is covered; `loadBudgetMonth` then keeps only the exact months.
 * @param {string} month `YYYY-MM`.
 * @returns {{ month: string, previousMonth: string, from: string, to: string }} ISO timestamps, `to` exclusive.
 */
export function budgetWindow(month) {
  const previousMonth = addMonths(month, -1);
  return {
    month,
    previousMonth,
    from: new Date(monthStart(previousMonth) - DAY_MS).toISOString(),
    to: new Date(monthStart(addMonths(month, 1)) + DAY_MS).toISOString(),
  };
}

const statusOf = (error) => error?.code ?? error?.status;

// Reads a table that may not exist yet and never throws: ok, missing (404) or unavailable.
async function readOptional(listRows, table, where) {
  try {
    return { rows: await listRows(table, where), status: 'ok' };
  } catch (error) {
    return { rows: [], status: statusOf(error) === 404 ? 'missing' : 'unavailable' };
  }
}

/**
 * Which lines the budget uses (AD15), the rule of the web `resolveBudgetLines`: `budget_lines` is the source once it exists and has
 * data, or exists empty with no legacy rows. Missing, unreadable, or empty while `budgets` has rows is 'legacy' (read-only).
 */
export function resolveLinesMode({ budgetLines, budgets }) {
  const legacy = budgetLines.status !== 'ok' || (budgetLines.rows.length === 0 && budgets.rows.length > 0);
  return { linesMode: legacy ? 'legacy' : 'lines', lines: legacy ? linesFromLegacyBudgets(budgets.rows) : budgetLines.rows };
}

/**
 * The one budget computation for Nia, with the web input rules: only the month's transactions, `previousMonthIncomeMinor` from M-1,
 * debt events null when debts or their events cannot be read (`debt_data_unavailable`).
 * @param {{ listRows: (table: string, where: object, range?: { field: string, from: string, to: string }) => Promise<object[]>,
 *   householdId: string, month: string, timezone: string, inScope?: (row: object) => boolean }} input
 *   `listRows` returns every flat row (paginated by the caller) and rejects with a `code` 404 when the table is missing.
 * @returns {Promise<{ linesMode: 'lines'|'legacy', lines: object[], categories: object[], budgetMonth: object }>}
 */
export async function loadBudgetMonth({ listRows, householdId, month, timezone, inScope = () => true }) {
  const { previousMonth, from, to } = budgetWindow(month);
  const where = { householdId };
  const [budgetLines, budgets, debts, events, categories, loaded] = await Promise.all([
    readOptional(listRows, T.lines, where),
    readOptional(listRows, T.legacy, where),
    readOptional(listRows, T.debts, where),
    readOptional(listRows, T.events, where),
    listRows(T.categories, where),
    listRows(T.transactions, where, { field: 'occurredAt', from, to }),
  ]);
  const monthOf = (row) => isoDateIn(new Date(row.occurredAt), timezone).slice(0, 7);
  const previousMonthIncomeMinor = loaded
    .filter((row) => row.type === 'income' && inScope(row) && monthOf(row) === previousMonth)
    .reduce((sum, row) => sum + Number(row.amountMinor || 0), 0);
  const { linesMode, lines } = resolveLinesMode({ budgetLines, budgets });
  const budgetMonth = computeBudgetMonth({
    month, lines, categories, transactions: loaded.filter((row) => monthOf(row) === month), previousMonthIncomeMinor, inScope,
    debts: debts.rows,
    debtEvents: debts.status === 'ok' && events.status === 'ok' ? events.rows : null,
  });
  return { linesMode, lines, categories, budgetMonth };
}

const isAmount = (value) => Number.isSafeInteger(value) && value > 0;

/**
 * Plans a "solo este mes" budget change (AD17): a one-month `fixed` line for a category, or a one-month tombstone (amount 0)
 * for a delete. The same call builds the preview and, with fresh lines, the plan to write after the confirmation.
 * @param {{ draft: { action: 'set'|'remove', categoryId: string, amountMinor?: number, month: string }, lines: object[],
 *   linesMode: 'lines'|'legacy', categories: object[], ctx: { actorId: string, source: string } }} input
 * @returns {{ ok: true, plan: object, text: string } | { ok: false, issue: string, text?: string }}
 */
export function planBudgetEdit({ draft, lines, linesMode, categories, ctx }) {
  if (linesMode !== 'lines') return { ok: false, issue: 'legacy_mode', text: LEGACY_REFUSAL };
  const category = categories.find((item) => (item.$id ?? item.id) === draft.categoryId);
  if (!category) return { ok: false, issue: 'unknown_category' };
  if (category.kind === 'income') return { ok: false, issue: 'income_category' };
  if (category.kind === 'debt') return { ok: false, issue: 'debt_category' };
  const remove = draft.action === 'remove';
  if (!remove && !isAmount(draft.amountMinor)) return { ok: false, issue: 'invalid_amount' };

  const plan = planLineEdit(lines, {
    target: { targetType: 'category', targetId: draft.categoryId },
    rule: 'fixed', value: remove ? 0 : draft.amountMinor, month: draft.month, span: 'month', action: draft.action,
    actorId: ctx.actorId, source: ctx.source, categoriesById: new Map(categories.map((item) => [item.$id ?? item.id, item])),
  });
  if (!plan.ok) return { ok: false, issue: plan.code };
  const head = remove ? `Quitar el presupuesto de ${category.name} en ${draft.month}: solo este mes.` : `Presupuesto de ${category.name}: ${pesos(draft.amountMinor)} solo este mes (${draft.month}).`;
  const text = [head, 'El plan recurrente no cambia.', '', 'Vista previa: no se guarda hasta que confirmes.'].join('\n');
  return { ok: true, plan, text };
}

/** The rows to write, updates first (the order the web applies), only to `budget_lines`; never to the legacy `budgets`. */
export function budgetWrites(plan, householdId) {
  const stamped = (op, row) => ({ op, table: T.lines, id: row.id, data: { ...row.data, householdId } });
  return [...plan.updates.map((row) => stamped('update', row)), ...plan.creates.map((row) => stamped('create', row))];
}

/**
 * The code-computed figures the replies quote (NB-3): the model never does budget arithmetic.
 * @param {object} budgetMonth Output of `computeBudgetMonth`.
 */
export function budgetFigures(budgetMonth) {
  const { groups, totals, base, month, warnings } = budgetMonth;
  return {
    month,
    incomeSource: base.source,
    incomeMinor: base.incomeMinor,
    allocatedMinor: totals.allocatedMinor,
    actualMinor: totals.outflowMinor,
    porAsignarMinor: totals.porAsignarMinor,
    groups: BUDGET_GROUPS.map((group) => ({ group, allocatedMinor: groups[group].allocatedMinor, actualMinor: groups[group].actualMinor, remainingMinor: groups[group].remainingMinor })),
    warnings,
  };
}
