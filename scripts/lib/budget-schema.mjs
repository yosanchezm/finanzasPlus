/**
 * Budget lines schema for scripts/migrate-appwrite.mjs (additive, create-only).
 *
 * Same plain-data shape as legal-schema.mjs. `budget_lines` holds the household's budget plan: one row per
 * target (a category or a money group) and validity window (`fromMonth` to `toMonth`, null = open-ended).
 * There is no unique index: resolving duplicates is the job of the core resolver, so migrated rows never block the build.
 * Table permissions are bare actions that `withBudgetSchema` qualifies with the household team.
 * Row permissions (team read + update) are set by the writers when they insert a row. There is no delete.
 * The existing `budgets` table is not touched; it stays as the read-only fallback.
 *
 * String sizes are immutable once created in Appwrite, so they include headroom.
 */

const str = (key, size, required = false) => ({ key, type: 'string', size, required });
const int = (key, required = false) => ({ key, type: 'integer', required });

export const BUDGET_TABLES = [
  {
    id: 'budget_lines',
    name: 'Líneas de presupuesto',
    rowSecurity: true,
    permissions: ['read', 'create', 'update'],
    columns: [
      str('householdId', 36, true), str('targetType', 16, true), str('targetId', 36, true), str('rule', 16, true),
      int('amountMinor'), int('percentBp'), str('fromMonth', 7, true), str('toMonth', 7), int('alertAtPercent'),
      str('actorId', 36, true), str('source', 16, true),
    ],
    indexes: [
      { key: 'by_household_from', type: 'key', columns: ['householdId', 'fromMonth'], orders: [] },
      { key: 'by_household_target', type: 'key', columns: ['householdId', 'targetType', 'targetId'], orders: [] },
    ],
  },
];

/**
 * Returns the migration tables plus `budget_lines` (permissions qualified with `team`), without mutating the input.
 * Throws if the table is already defined, so a table is never silently redefined.
 * Chain it after `withLegalSchema`: `withBudgetSchema(withLegalSchema(withDebtSchema(base, team), team), team)`.
 *
 * @param {object[]} tables Existing migration table definitions.
 * @param {(action: string) => string} team Builds a permission string, for example `read("team:...")`.
 */
export function withBudgetSchema(tables, team) {
  const existingIds = new Set(tables.map((table) => table.id));
  for (const table of BUDGET_TABLES) {
    if (existingIds.has(table.id)) throw new Error(`The migration already defines table ${table.id}.`);
  }
  return [...tables, ...BUDGET_TABLES.map((table) => ({ ...table, permissions: table.permissions.map(team) }))];
}
