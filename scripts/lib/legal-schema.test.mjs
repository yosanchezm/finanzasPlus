// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withDebtSchema } from './debt-schema.mjs';
import { LEGAL_TABLES, withLegalSchema } from './legal-schema.mjs';

const root = process.cwd();
const migrateScript = resolve(root, 'scripts/migrate-appwrite.mjs');
const team = (action) => `${action}("team:team-test")`;

const tableById = (tables, id) => tables.find((candidate) => candidate.id === id);
const indexOf = (table, key) => table.indexes.find((candidate) => candidate.key === key);

// A stand-in for the tables the migration script already defines (withDebtSchema needs transactions).
const existing = () => [
  { id: 'households', name: 'Hogares', rowSecurity: true, permissions: [team('read')], columns: [{ key: 'name', type: 'string', size: 120, required: true }], indexes: [] },
  {
    id: 'transactions', name: 'Movimientos', rowSecurity: true, permissions: [team('create')],
    columns: [{ key: 'householdId', type: 'string', size: 36, required: true }],
    indexes: [{ key: 'by_household_date', type: 'key', columns: ['householdId', 'occurredAt'], orders: ['ASC', 'DESC'] }],
  },
];

describe('legal_rates table definition', () => {
  const legal = tableById(LEGAL_TABLES, 'legal_rates');

  it('defines exactly one table, legal_rates, with row security', () => {
    expect(LEGAL_TABLES.map((table) => table.id)).toEqual(['legal_rates']);
    expect(legal.rowSecurity).toBe(true);
  });

  it('columns, sizes and required flags match the design', () => {
    const shape = Object.fromEntries(legal.columns.map(({ key, type, size, required }) => [key, [type, size, required]]));
    expect(shape).toEqual({
      householdId: ['string', 36, true],
      kind: ['string', 16, true],
      modality: ['string', 24, true],
      validFrom: ['string', 10, true],
      validTo: ['string', 10, true],
      value: ['integer', undefined, true],
      source: ['string', 200, false],
      verified: ['boolean', undefined, false],
      actorId: ['string', 36, true],
    });
  });

  it('has the unique key by_household_kind_modality_from and the by_household lookup key', () => {
    expect(indexOf(legal, 'by_household_kind_modality_from')).toEqual({
      key: 'by_household_kind_modality_from', type: 'unique', columns: ['householdId', 'kind', 'modality', 'validFrom'], orders: [],
    });
    expect(indexOf(legal, 'by_household')).toEqual({ key: 'by_household', type: 'key', columns: ['householdId'], orders: [] });
    expect(legal.indexes).toHaveLength(2);
  });

  it('every index references columns that exist and column keys are unique', () => {
    const keys = legal.columns.map((candidate) => candidate.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const definition of legal.indexes) for (const name of definition.columns) expect(keys).toContain(name);
  });

  it('table permissions are read/create/update and never delete (rows are superseded by editing)', () => {
    expect(legal.permissions).toEqual(['read', 'create', 'update']);
    expect(legal.permissions).not.toContain('delete');
  });
});

describe('withLegalSchema (additive merge)', () => {
  it('appends legal_rates with team-qualified permissions and keeps the existing tables first', () => {
    const merged = withLegalSchema(existing(), team);

    expect(merged.map((table) => table.id)).toEqual(['households', 'transactions', 'legal_rates']);
    expect(tableById(merged, 'legal_rates').permissions).toEqual([team('read'), team('create'), team('update')]);
    expect(tableById(merged, 'households')).toEqual(tableById(existing(), 'households'));
    expect(tableById(merged, 'transactions')).toEqual(tableById(existing(), 'transactions'));
  });

  it('does not mutate the tables it receives', () => {
    const input = existing();
    const snapshot = JSON.stringify(input);
    withLegalSchema(input, team);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('refuses a collision with a table that already exists, also on a second merge', () => {
    const once = withLegalSchema(existing(), team);
    expect(() => withLegalSchema(once, team)).toThrow(/legal_rates/);
    const colliding = [...existing(), { id: 'legal_rates', name: 'x', rowSecurity: true, permissions: [], columns: [], indexes: [] }];
    expect(() => withLegalSchema(colliding, team)).toThrow(/already defines table legal_rates/);
  });

  it('a rerun builds the same tables from the same base (the ensure loops then find them and change nothing)', () => {
    const run = () => withLegalSchema(withDebtSchema(existing(), team), team);
    expect(run()).toEqual(run());
    expect(run().map((table) => table.id)).toEqual(['households', 'transactions', 'debts', 'debt_events', 'legal_rates']);
  });

  it('chains after withDebtSchema: the debt tables stay in place and legal_rates comes last', () => {
    const merged = withLegalSchema(withDebtSchema(existing(), team), team);

    expect(merged.map((table) => table.id)).toEqual(['households', 'transactions', 'debts', 'debt_events', 'legal_rates']);
    expect(tableById(merged, 'debts').permissions).toEqual([team('read'), team('create'), team('update')]);
  });
});

describe('migrate-appwrite.mjs integration (static, never executed)', () => {
  const source = readFileSync(migrateScript, 'utf8');

  it('parses as valid JavaScript without running (node --check)', () => {
    expect(() => execFileSync(process.execPath, ['--check', migrateScript], { stdio: 'pipe' })).not.toThrow();
  });

  it('imports the legal schema and chains withLegalSchema after withDebtSchema', () => {
    expect(source).toMatch(/from '\.\/lib\/legal-schema\.mjs'/);
    expect(source).toMatch(/withLegalSchema\(\s*withDebtSchema\(baseTables, team\), team\)/);
  });

  it('stays create-only: the ensure loops are unchanged and nothing is deleted or altered', () => {
    expect(source).toMatch(/for \(const column of table\.columns\) await ensureColumn/);
    expect(source).toMatch(/for \(const definition of table\.indexes\) await ensureIndex/);
    expect(source).not.toMatch(/method: 'DELETE'/);
    expect(source).not.toMatch(/method: 'PATCH'/);
  });

  it('its table id does not collide with the ones the script already defines', () => {
    const ids = [...source.matchAll(/^\s*id: '([a-z_]+)'/gm)].map((match) => match[1]);
    expect(ids.length).toBeGreaterThanOrEqual(9);
    for (const table of LEGAL_TABLES) expect(ids).not.toContain(table.id);
  });
});
