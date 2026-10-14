/**
 * Legal-rates schema for scripts/migrate-appwrite.mjs (additive, create-only).
 *
 * Same plain-data shape as debt-schema.mjs. `legal_rates` stores the household's IBC, usury cap and
 * SMMLV figures: `value` is an integer in basis points for `ibc`/`usury` and in pesos for `smmlv`.
 * Table permissions are bare actions that `withLegalSchema` qualifies with the household team.
 * Row permissions (team read + update) are set by the writers when they insert a row.
 * There is no delete: a row is superseded by editing it.
 *
 * String sizes are immutable once created in Appwrite, so they include headroom.
 */

const str = (key, size, required = false) => ({ key, type: 'string', size, required });
const int = (key, required = false) => ({ key, type: 'integer', required });
const bool = (key, required = false) => ({ key, type: 'boolean', required });

export const LEGAL_TABLES = [
  {
    id: 'legal_rates',
    name: 'Tasas legales',
    rowSecurity: true,
    permissions: ['read', 'create', 'update'],
    columns: [
      str('householdId', 36, true), str('kind', 16, true), str('modality', 24, true),
      str('validFrom', 10, true), str('validTo', 10, true), int('value', true),
      str('source', 200), bool('verified'), str('actorId', 36, true),
    ],
    indexes: [
      { key: 'by_household_kind_modality_from', type: 'unique', columns: ['householdId', 'kind', 'modality', 'validFrom'], orders: [] },
      { key: 'by_household', type: 'key', columns: ['householdId'], orders: [] },
    ],
  },
];

/**
 * Returns the migration tables plus `legal_rates` (permissions qualified with `team`), without mutating the input.
 * Throws if the table is already defined, so a table is never silently redefined.
 * Chain it after `withDebtSchema`: `withLegalSchema(withDebtSchema(base, team), team)`.
 *
 * @param {object[]} tables Existing migration table definitions.
 * @param {(action: string) => string} team Builds a permission string, for example `read("team:...")`.
 */
export function withLegalSchema(tables, team) {
  const existingIds = new Set(tables.map((table) => table.id));
  for (const table of LEGAL_TABLES) {
    if (existingIds.has(table.id)) throw new Error(`The migration already defines table ${table.id}.`);
  }
  return [...tables, ...LEGAL_TABLES.map((table) => ({ ...table, permissions: table.permissions.map(team) }))];
}
