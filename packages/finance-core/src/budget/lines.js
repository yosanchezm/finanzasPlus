import { GROUPS, categoryOf } from './groups.js';
import { lineIds, targetKey } from './ids.js';

// Budget lines: validation, resolution per target and month (AD2), legacy `budgets` mapping. Pure.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_BP = 10000;
const BUDGET_GROUPS = GROUPS.filter((group) => group !== 'income');
const idOf = (line) => String(line.$id ?? line.id ?? '');
const isNonNegativeInt = (value) => Number.isSafeInteger(value) && value >= 0;

/** `{ ok: true }` or `{ ok: false, code }`. Income targets are rejected (AD16); an unknown category is not (callers report it). */
export function validateLine(line, categoriesById) {
  const fail = (code) => ({ ok: false, code });
  if (line.targetType !== 'category' && line.targetType !== 'group') return fail('invalid_target_type');
  if (typeof line.targetId !== 'string' || line.targetId === '') return fail('missing_target_id');
  if (line.targetType === 'group') {
    if (line.targetId === 'income') return fail('income_target');
    if (!BUDGET_GROUPS.includes(line.targetId)) return fail('invalid_target_id');
  } else if (categoryOf(categoriesById, line.targetId)?.kind === 'income') return fail('income_target');
  if (line.rule === 'fixed') {
    if (!isNonNegativeInt(line.amountMinor)) return fail('invalid_amount');
  } else if (line.rule === 'percent') {
    if (!isNonNegativeInt(line.percentBp) || line.percentBp > MAX_BP) return fail('invalid_percent');
  } else return fail('invalid_rule');
  if (!MONTH.test(String(line.fromMonth))) return fail('invalid_from_month');
  if (line.toMonth != null) {
    if (!MONTH.test(String(line.toMonth))) return fail('invalid_to_month');
    if (line.toMonth < line.fromMonth) return fail('to_before_from');
  }
  return { ok: true };
}

/** True when the line is in force in `month` (`YYYY-MM`, both ends inclusive, null `toMonth` = open-ended). */
export const coversMonth = (line, month) => line.fromMonth <= month && (line.toMonth == null || line.toMonth >= month);

// Positive when `a` beats `b` for `month`: one-month line, latest fromMonth, narrower toMonth, greatest id.
function compare(a, b, month) {
  const single = (line) => line.fromMonth === month && line.toMonth === month;
  if (single(a) !== single(b)) return single(a) ? 1 : -1;
  if (a.fromMonth !== b.fromMonth) return a.fromMonth > b.fromMonth ? 1 : -1;
  if ((a.toMonth == null) !== (b.toMonth == null)) return a.toMonth == null ? -1 : 1;
  if (a.toMonth !== b.toMonth) return a.toMonth < b.toMonth ? 1 : -1;
  if (idOf(a) === idOf(b)) return 0;
  return idOf(a) > idOf(b) ? 1 : -1;
}

/** Winner per `targetKey` for `month`, independent of input order; null when no line covers it. */
export function resolveLines(lines, month) {
  const winners = new Map();
  for (const line of lines) {
    const key = targetKey(line);
    const current = winners.get(key) ?? null;
    if (!winners.has(key)) winners.set(key, null);
    if (coversMonth(line, month) && (current === null || compare(line, current, month) > 0)) winners.set(key, line);
  }
  return winners;
}

/** Legacy `budgets` rows as one-month fixed lines `bl{id}` (AD15); rows without month, category or amount are skipped. */
export function linesFromLegacyBudgets(budgets) {
  return (budgets || [])
    .filter((row) => row.month && row.categoryId && Number(row.plannedMinor) > 0)
    .map((row) => ({
      $id: lineIds.migrated(row.$id ?? row.id),
      targetType: 'category',
      targetId: row.categoryId,
      rule: 'fixed',
      amountMinor: Number(row.plannedMinor),
      percentBp: null,
      fromMonth: row.month,
      toMonth: row.month,
      alertAtPercent: row.alertAtPercent ?? null,
      actorId: 'migration',
      source: 'migration',
    }));
}
