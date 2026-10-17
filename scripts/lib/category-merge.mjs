/**
 * Pure planner for merging duplicate categories. No I/O: the CLI in
 * scripts/merge-categories.mjs loads the rows, calls planMerge and applies
 * the returned plan.
 *
 * Rows are plain objects with an `id` (the CLI maps Appwrite's `$id`).
 */

import { foldCategoryName } from '../../packages/finance-core/index.js';

/** Normalizes a category name for matching: "  Alimentación " → "alimentacion". Same rule as the app and Nia. */
export const foldName = foldCategoryName;

function describe(matches) {
  return matches.map((row) => `"${row.name}" (${row.id}${row.archived ? ', archivada' : ''})`).join(', ');
}

function byFoldedName(categories, name) {
  const folded = foldName(name);
  return categories.filter((row) => foldName(row.name) === folded);
}

// The duplicate may be active, or already archived by a previous run (then
// only leftovers still pointing to it are repointed).
function resolveFrom(categories, name) {
  const matches = byFoldedName(categories, name);
  const active = matches.filter((row) => !row.archived);
  if (active.length === 1) return active[0];
  if (active.length > 1) throw new Error(`Ambiguous category "${name}": ${describe(active)}`);
  const archived = matches.filter((row) => row.archived);
  if (archived.length === 1) return archived[0];
  if (archived.length > 1) throw new Error(`Ambiguous category "${name}" (only archived matches): ${describe(archived)}`);
  throw new Error(`Unknown category "${name}"`);
}

// The category that stays must be active.
function resolveInto(categories, name) {
  const active = byFoldedName(categories, name).filter((row) => !row.archived);
  if (active.length === 1) return active[0];
  if (active.length > 1) throw new Error(`Ambiguous category "${name}": ${describe(active)}`);
  throw new Error(`Unknown or archived category "${name}" (the category that stays must be active)`);
}

function validateMerges(merges) {
  const froms = new Set();
  for (const { from, into } of merges) {
    const foldedFrom = foldName(from);
    if (foldedFrom === foldName(into)) throw new Error(`Cannot merge "${from}" into itself`);
    if (froms.has(foldedFrom)) throw new Error(`Category "${from}" is merged more than once`);
    froms.add(foldedFrom);
  }
  for (const { into } of merges) {
    if (froms.has(foldName(into))) {
      throw new Error(`Chain detected: "${into}" is both merged away and kept; merge into the final category directly`);
    }
  }
}

/**
 * @param {{ categories: object[], transactions: object[], budgets: object[], merges: {from: string, into: string}[] }} input
 * @returns {{
 *   transactionUpdates: {id: string, from: string, to: string}[],
 *   budgetUpdates: {id: string, categoryId: string}[],
 *   budgetMerges: {keepId: string, removeId: string, plannedMinor: number, alertAtPercent: number|null}[],
 *   archive: string[],
 *   summary: {from: string, into: string, transactions: number, budgets: number}[],
 * }}
 */
export function planMerge({ categories, transactions, budgets, merges }) {
  validateMerges(merges);

  const pairs = merges.map(({ from, into }) => {
    const source = resolveFrom(categories, from);
    const target = resolveInto(categories, into);
    if (source.id === target.id) throw new Error(`Cannot merge "${from}" into itself`);
    if (source.householdId !== target.householdId) {
      throw new Error(`"${source.name}" and "${target.name}" belong to different households`);
    }
    return { source, target };
  });

  const plan = { transactionUpdates: [], budgetUpdates: [], budgetMerges: [], archive: [], summary: [] };

  // Budget that ends up holding each (household, month, kept category) slot,
  // with its running amount. Seeded lazily from the kept category's budgets;
  // a repointed duplicate budget takes the slot when the kept one has none.
  const slots = new Map();
  const slotKey = (householdId, month, categoryId) => `${householdId}|${month}|${categoryId}`;
  const findSlot = (householdId, month, categoryId) => {
    const key = slotKey(householdId, month, categoryId);
    if (!slots.has(key)) {
      const kept = budgets.find((row) => row.householdId === householdId && row.month === month && row.categoryId === categoryId);
      slots.set(key, kept ? { id: kept.id, plannedMinor: kept.plannedMinor, alertAtPercent: kept.alertAtPercent ?? null } : null);
    }
    return slots.get(key);
  };

  for (const { source, target } of pairs) {
    const movedTransactions = transactions.filter((row) => row.categoryId === source.id);
    for (const row of movedTransactions) plan.transactionUpdates.push({ id: row.id, from: source.id, to: target.id });

    const movedBudgets = budgets.filter((row) => row.categoryId === source.id);
    for (const row of movedBudgets) {
      const slot = findSlot(row.householdId, row.month, target.id);
      if (slot) {
        slot.plannedMinor += row.plannedMinor;
        slot.alertAtPercent = slot.alertAtPercent ?? row.alertAtPercent ?? null;
        plan.budgetMerges.push({ keepId: slot.id, removeId: row.id, plannedMinor: slot.plannedMinor, alertAtPercent: slot.alertAtPercent });
      } else {
        plan.budgetUpdates.push({ id: row.id, categoryId: target.id });
        slots.set(slotKey(row.householdId, row.month, target.id), {
          id: row.id, plannedMinor: row.plannedMinor, alertAtPercent: row.alertAtPercent ?? null,
        });
      }
    }

    if (!source.archived) plan.archive.push(source.id);
    plan.summary.push({ from: source.name, into: target.name, transactions: movedTransactions.length, budgets: movedBudgets.length });
  }

  return plan;
}
