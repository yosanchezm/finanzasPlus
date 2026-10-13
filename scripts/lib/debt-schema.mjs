/**
 * Debt-management schema for scripts/migrate-appwrite.mjs (additive only).
 *
 * Plain data: columns use the same `{ key, type, size, required }` shape and
 * indexes the same `{ key, type, columns, orders }` shape as the migration
 * script. Table permissions are bare actions; `withDebtSchema` qualifies them
 * with the household team. Row-level permissions are set by the app when it
 * inserts a row (see src/appwrite.js).
 *
 * String sizes are immutable once created in Appwrite, so they include headroom.
 */

const str = (key, size, required = false) => ({ key, type: 'string', size, required });
const int = (key, required = false) => ({ key, type: 'integer', required });
const key = (name, columns) => ({ key: name, type: 'key', columns, orders: [] });
const unique = (name, columns) => ({ key: name, type: 'unique', columns, orders: [] });

export const DEBT_TABLES = [
  {
    id: 'debts',
    name: 'Deudas',
    rowSecurity: true,
    // Rows get team read + update at insert time. No delete: debts are archived.
    permissions: ['read', 'create', 'update'],
    columns: [
      str('householdId', 36, true), str('name', 120, true), str('kind', 24, true), str('ownerScope', 16, true),
      str('lender', 120), str('status', 16, true), str('currency', 3, true), int('principalMinor', true),
      str('openedOn', 10, true), str('termsJson', 8000, true), int('termsVersion', true), str('actorId', 36, true),
    ],
    indexes: [key('by_household_status', ['householdId', 'status'])],
  },
  {
    id: 'debt_events',
    name: 'Eventos de deuda',
    rowSecurity: true,
    // Append-only, like ai_events: rows get team read at insert time, never update or delete.
    permissions: ['read', 'create'],
    columns: [
      str('householdId', 36, true), str('debtId', 36, true), str('kind', 24, true), str('effectiveOn', 10, true),
      int('amountMinor', true), str('payloadJson', 8000), str('actorId', 36, true), str('source', 16, true),
      str('dedupeKey', 160, true),
    ],
    indexes: [
      key('by_household_debt_date', ['householdId', 'debtId', 'effectiveOn']),
      unique('by_dedupe', ['dedupeKey']),
    ],
  },
];

/** Optional link from an expense row to the debt that produced it. */
export const TRANSACTIONS_DEBT_PATCH = {
  tableId: 'transactions',
  columns: [str('debtId', 36)],
  indexes: [key('by_household_debt', ['householdId', 'debtId'])],
};

/**
 * Returns the migration tables plus the debt schema, without mutating the input:
 * the two new tables are appended (permissions qualified with `team`) and the
 * `transactions` table gets the `debtId` column and index.
 * Throws if any of those resources is already defined, so a table or column is
 * never silently redefined.
 *
 * @param {object[]} tables Existing migration table definitions.
 * @param {(action: string) => string} team Builds a permission string, for example `read("team:...")`.
 */
export function withDebtSchema(tables, team) {
  const existingIds = new Set(tables.map((table) => table.id));
  for (const table of DEBT_TABLES) {
    if (existingIds.has(table.id)) throw new Error(`The migration already defines table ${table.id}.`);
  }
  const patch = TRANSACTIONS_DEBT_PATCH;
  const target = tables.find((table) => table.id === patch.tableId);
  if (!target) throw new Error(`The migration has no ${patch.tableId} table to extend.`);
  for (const column of patch.columns) {
    if (target.columns.some((candidate) => candidate.key === column.key)) {
      throw new Error(`${patch.tableId} already defines column ${column.key}.`);
    }
  }
  for (const definition of patch.indexes) {
    if (target.indexes.some((candidate) => candidate.key === definition.key)) {
      throw new Error(`${patch.tableId} already defines index ${definition.key}.`);
    }
  }

  const merged = tables.map((table) => (table.id === patch.tableId
    ? { ...table, columns: [...table.columns, ...patch.columns], indexes: [...table.indexes, ...patch.indexes] }
    : table));
  const added = DEBT_TABLES.map((table) => ({ ...table, permissions: table.permissions.map(team) }));
  return [...merged, ...added];
}
