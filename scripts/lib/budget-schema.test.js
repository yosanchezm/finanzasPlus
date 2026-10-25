// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withDebtSchema } from './debt-schema.mjs';
import { BUDGET_TABLES, withBudgetSchema } from './budget-schema.mjs';
import { withLegalSchema } from './legal-schema.mjs';

const migrateScript = resolve(process.cwd(), 'scripts/migrate-appwrite.mjs');
const team = (action) => `${action}("team:team-test")`;
const tableById = (tables, id) => tables.find((candidate) => candidate.id === id);

// A stand-in for the tables the migration script already defines (withDebtSchema needs transactions).
const existing = () => [
  { id: 'households', name: 'Hogares', rowSecurity: true, permissions: [team('read')], columns: [{ key: 'name', type: 'string', size: 120, required: true }], indexes: [] },
  { id: 'budgets', name: 'Presupuestos', rowSecurity: true, permissions: [team('read')], columns: [{ key: 'month', type: 'string', size: 7, required: true }], indexes: [] },
  {
    id: 'transactions', name: 'Movimientos', rowSecurity: true, permissions: [team('create')],
    columns: [{ key: 'householdId', type: 'string', size: 36, required: true }],
    indexes: [{ key: 'by_household_date', type: 'key', columns: ['householdId', 'occurredAt'], orders: ['ASC', 'DESC'] }],
  },
];
const chain = () => withBudgetSchema(withLegalSchema(withDebtSchema(existing(), team), team), team);

describe('budget_lines table definition', () => {
  const lines = tableById(BUDGET_TABLES, 'budget_lines');

  it('defines exactly one table, budget_lines, with row security', () => {
    expect(BUDGET_TABLES.map((table) => table.id)).toEqual(['budget_lines']);
    expect(lines.rowSecurity).toBe(true);
  });

  it('columns, types, sizes and required flags match the design', () => {
    const shape = Object.fromEntries(lines.columns.map(({ key, type, size, required }) => [key, [type, size, required]]));
    expect(shape).toEqual({
      householdId: ['string', 36, true],
      targetType: ['string', 16, true],
      targetId: ['string', 36, true],
      rule: ['string', 16, true],
      amountMinor: ['integer', undefined, false],
      percentBp: ['integer', undefined, false],
      fromMonth: ['string', 7, true],
      toMonth: ['string', 7, false],
      alertAtPercent: ['integer', undefined, false],
      actorId: ['string', 36, true],
      source: ['string', 16, true],
    });
  });

  it('has the two lookup indexes and no unique index (resolution handles duplicates)', () => {
    expect(lines.indexes).toEqual([
      { key: 'by_household_from', type: 'key', columns: ['householdId', 'fromMonth'], orders: [] },
      { key: 'by_household_target', type: 'key', columns: ['householdId', 'targetType', 'targetId'], orders: [] },
    ]);
    expect(lines.indexes.some((definition) => definition.type === 'unique')).toBe(false);
  });

  it('every index references columns that exist and column keys are unique', () => {
    const keys = lines.columns.map((candidate) => candidate.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const definition of lines.indexes) for (const name of definition.columns) expect(keys).toContain(name);
  });

  it('table permissions are read/create/update and never delete', () => {
    expect(lines.permissions).toEqual(['read', 'create', 'update']);
  });
});

describe('withBudgetSchema (additive merge)', () => {
  it('appends budget_lines with team-qualified permissions and leaves budgets untouched', () => {
    const merged = withBudgetSchema(existing(), team);
    expect(merged.map((table) => table.id)).toEqual(['households', 'budgets', 'transactions', 'budget_lines']);
    expect(tableById(merged, 'budget_lines').permissions).toEqual([team('read'), team('create'), team('update')]);
    expect(tableById(merged, 'budgets')).toEqual(tableById(existing(), 'budgets'));
  });

  it('does not mutate the tables it receives', () => {
    const input = existing();
    const snapshot = JSON.stringify(input);
    withBudgetSchema(input, team);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('refuses a collision with a table that already exists, also on a second merge', () => {
    const once = withBudgetSchema(existing(), team);
    expect(() => withBudgetSchema(once, team)).toThrow(/already defines table budget_lines/);
    const colliding = [...existing(), { id: 'budget_lines', name: 'x', rowSecurity: true, permissions: [], columns: [], indexes: [] }];
    expect(() => withBudgetSchema(colliding, team)).toThrow(/budget_lines/);
  });

  it('chains after the legal and debt schemas and leaves every prior table unchanged', () => {
    const prior = withLegalSchema(withDebtSchema(existing(), team), team);
    const merged = chain();
    expect(merged.map((table) => table.id)).toEqual(['households', 'budgets', 'transactions', 'debts', 'debt_events', 'legal_rates', 'budget_lines']);
    expect(merged.slice(0, prior.length)).toEqual(prior);
    expect(chain()).toEqual(chain());
  });
});

describe('migrate-appwrite.mjs integration (static, never executed)', () => {
  const source = readFileSync(migrateScript, 'utf8');

  it('parses as valid JavaScript without running (node --check)', () => {
    expect(() => execFileSync(process.execPath, ['--check', migrateScript], { stdio: 'pipe' })).not.toThrow();
  });

  it('imports the budget schema and chains withBudgetSchema after withLegalSchema', () => {
    expect(source).toMatch(/from '\.\/lib\/budget-schema\.mjs'/);
    expect(source).toMatch(/withBudgetSchema\(\s*withLegalSchema\(\s*withDebtSchema\(baseTables, team\), team\), team\)/);
  });

  it('its table id does not collide with the ones the script already defines', () => {
    const ids = [...source.matchAll(/^\s*id: '([a-z_]+)'/gm)].map((match) => match[1]);
    for (const table of BUDGET_TABLES) expect(ids).not.toContain(table.id);
  });
});
