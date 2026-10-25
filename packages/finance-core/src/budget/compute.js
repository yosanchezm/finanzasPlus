import { activeEvents } from '../ledger/events.js';
import { roundUnit } from '../money.js';
import { CONSUMPTION, GROUPS, classifyTransaction, groupOfKind } from './groups.js';
import { resolveLines } from './lines.js';
import { targetKey } from './ids.js';

// computeBudgetMonth: the one pure computation behind BudgetView, the dashboard and Nia (AD6-AD13). Node 16 safe.
//
// Known limitation (no dedupe by design): a credit-card purchase counts in its category when it is recorded,
// and the later payment to the card debt counts again as a debt payment.

const BUDGET_GROUPS = GROUPS.filter((group) => group !== 'income');
const PAID_KINDS = ['payment', 'extra_payment'];
const sum = (items, pick) => items.reduce((total, item) => total + pick(item), 0);

// Active (not voided) payment events of in-scope debts in the month. Null when the events cannot be read.
export function debtPaymentEvents(month, debts, debtEvents, inScope) {
  const inScopeDebts = new Set((debts || []).filter(inScope).map((debt) => debt.$id ?? debt.id));
  try {
    return activeEvents(debtEvents)
      .filter((event) => PAID_KINDS.includes(event.kind) && event.effectiveOn.slice(0, 7) === month && inScopeDebts.has(event.debtId));
  } catch (error) {
    return null;
  }
}

// Debt payments of the month, summed. Null when the events cannot be read.
export function debtPayments(month, debts, debtEvents, inScope) {
  const events = debtPaymentEvents(month, debts, debtEvents, inScope);
  return events == null ? null : events.reduce((total, event) => total + event.amountMinor, 0);
}

export function computeBudgetMonth({ month, lines = [], categories = [], transactions = [], previousMonthIncomeMinor = 0, debts = [], debtEvents = null, inScope = () => true, scoped = false }) {
  const categoriesById = new Map(categories.map((category) => [category.$id ?? category.id, category]));
  const scopedTx = transactions.filter(inScope).map((tx) => ({ tx, group: classifyTransaction(tx, categoriesById) })).filter((item) => item.group);
  const warnings = [];

  const realIncome = sum(scopedTx.filter((item) => item.group === 'income'), (item) => item.tx.amountMinor);
  const base = realIncome > 0 ? { incomeMinor: realIncome, source: 'actual' }
    : previousMonthIncomeMinor > 0 ? { incomeMinor: previousMonthIncomeMinor, source: 'reference' }
      : { incomeMinor: 0, source: 'none' };

  const resolved = resolveLines(lines, month);
  const amountOf = (line) => (!line ? 0 : line.rule === 'percent' ? roundUnit((base.incomeMinor * line.percentBp) / 10000) : line.amountMinor);

  // Debt actual (AD10): payments replace cost rows that carry a debtId; kind-only rows are always added.
  const payments = debtEvents == null ? null : debtPayments(month, debts, debtEvents, inScope);
  if (payments == null) warnings.push({ code: 'debt_data_unavailable' });
  const counted = (item) => item.group !== 'debt' || payments == null || !item.tx.debtId;

  const groups = {};
  for (const group of BUDGET_GROUPS) {
    const own = scopedTx.filter((item) => item.group === group && counted(item));
    const actualMinor = sum(own, (item) => item.tx.amountMinor) + (group === 'debt' && payments != null ? payments : 0);
    const groupCategories = categories
      .filter((category) => !category.archived && category.kind !== 'income' && groupOfKind(category.kind) === group)
      .map((category) => {
        const id = category.$id ?? category.id;
        const line = resolved.get(targetKey({ targetType: 'category', targetId: id })) ?? null;
        const plannedMinor = amountOf(line);
        const categoryActual = sum(own.filter((item) => item.tx.categoryId === id), (item) => item.tx.amountMinor);
        return {
          categoryId: id, name: category.name, color: category.color, line, plannedMinor, actualMinor: categoryActual,
          remainingMinor: plannedMinor > 0 ? plannedMinor - categoryActual : 0,
          overBudget: plannedMinor > 0 && categoryActual > plannedMinor,
          householdFixed: scoped && line?.rule === 'fixed' && plannedMinor > 0,
        };
      });
    const envelope = amountOf(resolved.get(targetKey({ targetType: 'group', targetId: group })) ?? null);
    const subLimitsMinor = sum(groupCategories, (category) => category.plannedMinor);
    const allocatedMinor = envelope > 0 ? envelope : subLimitsMinor;
    if (envelope > 0 && subLimitsMinor > envelope) warnings.push({ code: 'sublimits_exceed_envelope', group, amountMinor: subLimitsMinor - envelope });
    groups[group] = {
      envelope: envelope > 0 ? envelope : null, allocatedMinor, subLimitsMinor, actualMinor,
      remainingMinor: allocatedMinor > 0 ? allocatedMinor - actualMinor : 0,
      overBudget: allocatedMinor > 0 && actualMinor > allocatedMinor,
      categories: groupCategories,
    };
  }

  // Presupuesto usado (AD12): only consumption targets with a non-zero limit.
  const budgetUsed = { plannedMinor: 0, spentMinor: 0 };
  for (const group of CONSUMPTION) {
    const { envelope, actualMinor, categories: rowsOf } = groups[group];
    const limited = envelope ? [{ plannedMinor: envelope, actualMinor }] : rowsOf.filter((category) => category.plannedMinor > 0);
    budgetUsed.plannedMinor += sum(limited, (item) => item.plannedMinor);
    budgetUsed.spentMinor += sum(limited, (item) => item.actualMinor);
  }

  const consumptionMinor = sum(CONSUMPTION, (group) => groups[group].actualMinor);
  const outflowMinor = consumptionMinor + groups.saving.actualMinor + groups.investment.actualMinor + groups.debt.actualMinor;
  const allocatedMinor = sum(BUDGET_GROUPS, (group) => groups[group].allocatedMinor);
  const porAsignarMinor = base.incomeMinor - allocatedMinor;
  if (porAsignarMinor < 0) warnings.push({ code: 'over_allocated' });
  const share = (amount) => (realIncome > 0 ? roundUnit((amount * 10000) / realIncome) : null);

  return {
    month, base, groups,
    totals: {
      incomeMinor: realIncome, consumptionMinor, savingMinor: groups.saving.actualMinor, investmentMinor: groups.investment.actualMinor,
      debtMinor: groups.debt.actualMinor, outflowMinor, balanceMinor: realIncome - outflowMinor, allocatedMinor, porAsignarMinor,
      budgetUsed, budgetUsedRatio: budgetUsed.plannedMinor > 0 ? budgetUsed.spentMinor / budgetUsed.plannedMinor : null,
    },
    rates: { savingsRateBp: share(groups.saving.actualMinor + groups.investment.actualMinor), debtShareBp: share(groups.debt.actualMinor) },
    warnings,
  };
}
