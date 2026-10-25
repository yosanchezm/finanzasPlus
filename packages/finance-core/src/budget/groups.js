// The six money groups and the one classifier every budget view shares (AD9).
// Pure and Node 16 safe.

export const GROUPS = ['income', 'need', 'want', 'saving', 'investment', 'debt'];

/** Consumption means need plus want; saving, investment and debt are never consumption. */
export const CONSUMPTION = ['need', 'want'];

/** Group of a category kind: the six known kinds as they are, anything else (or missing) is `need`. */
export const groupOfKind = (kind) => (GROUPS.includes(kind) ? kind : 'need');

/** Category by id from a `Map` or a plain object keyed by id; undefined when absent. */
export const categoryOf = (categoriesById, id) => {
  if (id == null || !categoriesById) return undefined;
  return typeof categoriesById.get === 'function' ? categoriesById.get(id) : categoriesById[id];
};

/**
 * The group a transaction belongs to, or null when it is ignored (transfers and other types).
 * An expense with a `debtId` is `debt`; an expense in an unknown, missing or `income`-kind category is `need`.
 */
export function classifyTransaction(tx, categoriesById) {
  if (tx.type === 'income') return 'income';
  if (tx.type !== 'expense') return null;
  if (tx.debtId) return 'debt';
  const kind = categoryOf(categoriesById, tx.categoryId)?.kind;
  return kind === 'income' ? 'need' : groupOfKind(kind);
}
