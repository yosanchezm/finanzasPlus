/**
 * Pure planner for migrating the legacy `budgets` rows into `budget_lines`. No I/O: the CLI in
 * scripts/migrate-budgets.mjs loads the rows, calls planBudgetMigration and applies the returned plan.
 *
 * Rows are plain objects with an `id` (the CLI maps Appwrite's `$id`).
 */

import { foldCategoryName, lineIds, linesFromLegacyBudgets, resolveLines, validateLine } from '../../packages/finance-core/index.js';

export const MAX_ID_LENGTH = 36;
const COST_CATEGORY_FOLDED = foldCategoryName('Costos financieros');

const idOf = (row) => String(row.$id ?? row.id ?? '');

function nextMonth(month) {
  const [year, number] = month.split('-').map(Number);
  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`;
}

// Why a legacy row cannot become a line, or null when it can.
function skipReason(row, categoriesById) {
  if (!row.month) return 'missing_month';
  if (!(Number(row.plannedMinor) > 0)) return 'zero_amount';
  const category = row.categoryId ? categoriesById.get(row.categoryId) : undefined;
  if (!category) return 'missing_category';
  if (category.kind === 'income') return 'income_category';
  if (lineIds.migrated(idOf(row)).length > MAX_ID_LENGTH) return 'id_too_long';
  return null;
}

function mapRows(budgets, categoriesById) {
  const mapped = [];
  const skipped = [];
  for (const row of budgets) {
    const reason = skipReason(row, categoriesById);
    if (reason) {
      skipped.push({ id: idOf(row), reason });
      continue;
    }
    const [line] = linesFromLegacyBudgets([row]);
    const check = validateLine(line, categoriesById);
    if (!check.ok) skipped.push({ id: idOf(row), reason: `invalid_line:${check.code}` });
    else mapped.push({ ...line, householdId: row.householdId });
  }
  return { mapped, skipped };
}

// One open-ended line per category with a mapped row in `month`; the resolution tie-break picks among duplicates.
function seedPlan(mapped, month) {
  const inMonth = mapped.filter((line) => line.fromMonth === month);
  const winners = resolveLines(inMonth, month);
  const seeds = [];
  const duplicates = [];
  for (const winner of winners.values()) {
    const ignoredIds = inMonth.filter((line) => line.targetId === winner.targetId && line.$id !== winner.$id).map((line) => line.$id);
    if (ignoredIds.length) duplicates.push({ targetId: winner.targetId, month, keptId: winner.$id, ignoredIds: ignoredIds.sort() });
    const fromMonth = nextMonth(month);
    seeds.push({
      $id: lineIds.seeded(winner, fromMonth),
      householdId: winner.householdId,
      targetType: 'category',
      targetId: winner.targetId,
      rule: 'fixed',
      amountMinor: winner.amountMinor,
      percentBp: null,
      fromMonth,
      toMonth: null,
      alertAtPercent: null,
      actorId: 'migration',
      source: 'migration',
    });
  }
  return { seeds, duplicates };
}

/**
 * @param {{ budgets: object[], existingLineIds: string[], categories: object[], seed?: boolean }} input
 * @returns {{
 *   creates: object[], seeds: object[], present: string[],
 *   skipped: {id: string, reason: string}[],
 *   duplicates: {targetId: string, month: string, keptId: string, ignoredIds: string[]}[],
 *   costCategoryPatches: {id: string, from: string, to: 'debt'}[],
 *   summary: {read: number, create: number, present: number, skipped: number, seed: number, duplicates: number, patches: number},
 * }}
 */
export function planBudgetMigration({ budgets, existingLineIds, categories, seed = true }) {
  const categoriesById = new Map(categories.map((row) => [row.id, row]));
  const existing = new Set(existingLineIds);
  const { mapped, skipped } = mapRows(budgets, categoriesById);

  const latest = mapped.reduce((max, line) => (line.fromMonth > max ? line.fromMonth : max), '');
  const { seeds: plannedSeeds, duplicates } = seed && latest ? seedPlan(mapped, latest) : { seeds: [], duplicates: [] };

  const present = [];
  const pending = (lines) => lines.filter((line) => {
    if (!existing.has(line.$id)) return true;
    present.push(line.$id);
    return false;
  });
  const creates = pending(mapped);
  const seeds = pending(plannedSeeds);

  const costCategoryPatches = categories
    .filter((row) => foldCategoryName(row.name) === COST_CATEGORY_FOLDED && row.kind !== 'debt')
    .map((row) => ({ id: row.id, from: row.kind, to: 'debt' }));

  return {
    creates,
    seeds,
    present,
    skipped,
    duplicates,
    costCategoryPatches,
    summary: {
      read: budgets.length,
      create: creates.length,
      present: present.length,
      skipped: skipped.length,
      seed: seeds.length,
      duplicates: duplicates.length,
      patches: costCategoryPatches.length,
    },
  };
}
