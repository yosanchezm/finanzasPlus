// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEBT_TABLES, TRANSACTIONS_DEBT_PATCH, withDebtSchema } from './debt-schema.mjs';

const root = process.cwd();
const migrateScript = resolve(root, 'scripts/migrate-appwrite.mjs');
const team = (action) => `${action}("team:team-test")`;

const column = (table, key) => table.columns.find((candidate) => candidate.key === key);
const indexOf = (table, key) => table.indexes.find((candidate) => candidate.key === key);
const tableById = (tables, id) => tables.find((candidate) => candidate.id === id);

// A stand-in for the tables the migration script already defines.
const existing = () => [
  { id: 'households', name: 'Hogares', rowSecurity: true, permissions: [team('read')], columns: [{ key: 'name', type: 'string', size: 120, required: true }], indexes: [] },
  {
    id: 'transactions', name: 'Movimientos', rowSecurity: true, permissions: [team('create')],
    columns: [{ key: 'householdId', type: 'string', size: 36, required: true }, { key: 'dedupeKey', type: 'string', size: 160, required: false }],
    indexes: [{ key: 'by_household_date', type: 'key', columns: ['householdId', 'occurredAt'], orders: ['ASC', 'DESC'] }],
  },
];

describe('debt tables definition', () => {
  const debts = tableById(DEBT_TABLES, 'debts');
  const events = tableById(DEBT_TABLES, 'debt_events');

  it('defines exactly the debts and debt_events tables with row security', () => {
    expect(DEBT_TABLES.map((table) => table.id)).toEqual(['debts', 'debt_events']);
    expect(debts.rowSecurity).toBe(true);
    expect(events.rowSecurity).toBe(true);
  });

  it('debts: columns, sizes and required flags match the design', () => {
    const shape = Object.fromEntries(debts.columns.map(({ key, type, size, required }) => [key, [type, size, required]]));
    expect(shape).toEqual({
      householdId: ['string', 36, true],
      name: ['string', 120, true],
      kind: ['string', 24, true],
      ownerScope: ['string', 16, true],
      lender: ['string', 120, false],
      status: ['string', 16, true],
      currency: ['string', 3, true],
      principalMinor: ['integer', undefined, true],
      openedOn: ['string', 10, true],
      termsJson: ['string', 8000, true],
      termsVersion: ['integer', undefined, true],
      actorId: ['string', 36, true],
    });
    expect(debts.indexes).toEqual([{ key: 'by_household_status', type: 'key', columns: ['householdId', 'status'], orders: [] }]);
  });

  it('debt_events: columns, sizes, unique dedupeKey and the date index match the design', () => {
    const shape = Object.fromEntries(events.columns.map(({ key, type, size, required }) => [key, [type, size, required]]));
    expect(shape).toEqual({
      householdId: ['string', 36, true],
      debtId: ['string', 36, true],
      kind: ['string', 24, true],
      effectiveOn: ['string', 10, true],
      amountMinor: ['integer', undefined, true],
      payloadJson: ['string', 8000, false],
      actorId: ['string', 36, true],
      source: ['string', 16, true],
      dedupeKey: ['string', 160, true],
    });
    expect(indexOf(events, 'by_dedupe')).toEqual({ key: 'by_dedupe', type: 'unique', columns: ['dedupeKey'], orders: [] });
    expect(indexOf(events, 'by_household_debt_date')).toEqual({
      key: 'by_household_debt_date', type: 'key', columns: ['householdId', 'debtId', 'effectiveOn'], orders: [],
    });
  });

  it('table permissions are actions only: debts read/create/update, events read/create (append-only)', () => {
    expect(debts.permissions).toEqual(['read', 'create', 'update']);
    expect(events.permissions).toEqual(['read', 'create']);
    expect(events.permissions).not.toContain('update');
    expect(events.permissions).not.toContain('delete');
    expect(debts.permissions).not.toContain('delete');
  });

  it('every index references columns that exist in its own table', () => {
    for (const table of DEBT_TABLES) {
      const keys = table.columns.map((candidate) => candidate.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const definition of table.indexes) {
        expect(definition.columns.length).toBeGreaterThan(0);
        for (const name of definition.columns) expect(keys).toContain(name);
      }
    }
  });

  it('stays inside the per-column and per-row budgets used by the existing tables', () => {
    for (const table of DEBT_TABLES) {
      const big = table.columns.filter((candidate) => (candidate.size ?? 0) >= 8000);
      expect(big.length).toBeLessThanOrEqual(2);
      for (const candidate of table.columns) if (candidate.type === 'string') expect(candidate.size).toBeLessThanOrEqual(8000);
    }
    expect(column(debts, 'termsJson').size).toBe(8000);
    expect(column(tableById(DEBT_TABLES, 'debt_events'), 'payloadJson').size).toBe(8000);
  });
});

describe('transactions patch', () => {
  it('adds an optional s36 debtId column and the by_household_debt index', () => {
    expect(TRANSACTIONS_DEBT_PATCH.tableId).toBe('transactions');
    expect(TRANSACTIONS_DEBT_PATCH.columns).toEqual([{ key: 'debtId', type: 'string', size: 36, required: false }]);
    expect(TRANSACTIONS_DEBT_PATCH.indexes).toEqual([
      { key: 'by_household_debt', type: 'key', columns: ['householdId', 'debtId'], orders: [] },
    ]);
  });
});

describe('withDebtSchema (additive merge)', () => {
  it('appends the two tables with team-qualified permissions and keeps the existing ones first', () => {
    const merged = withDebtSchema(existing(), team);

    expect(merged.map((table) => table.id)).toEqual(['households', 'transactions', 'debts', 'debt_events']);
    expect(tableById(merged, 'debts').permissions).toEqual(['read("team:team-test")', 'create("team:team-test")', 'update("team:team-test")']);
    expect(tableById(merged, 'debt_events').permissions).toEqual(['read("team:team-test")', 'create("team:team-test")']);
  });

  it('merges the debtId column and index into transactions without touching what is there', () => {
    const merged = withDebtSchema(existing(), team);
    const transactions = tableById(merged, 'transactions');

    expect(transactions.columns.map((candidate) => candidate.key)).toEqual(['householdId', 'dedupeKey', 'debtId']);
    expect(transactions.indexes.map((candidate) => candidate.key)).toEqual(['by_household_date', 'by_household_debt']);
    expect(transactions.permissions).toEqual([team('create')]);
    expect(tableById(merged, 'households')).toEqual(tableById(existing(), 'households'));
  });

  it('does not mutate the tables it receives', () => {
    const input = existing();
    const snapshot = JSON.stringify(input);
    withDebtSchema(input, team);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('is idempotent in shape: a second merge is refused instead of duplicating keys', () => {
    const once = withDebtSchema(existing(), team);
    expect(() => withDebtSchema(once, team)).toThrow(/already defines/);
  });

  it('refuses to collide with an existing column or index on transactions', () => {
    const withColumn = existing();
    withColumn[1].columns.push({ key: 'debtId', type: 'string', size: 36, required: false });
    expect(() => withDebtSchema(withColumn, team)).toThrow(/debtId/);

    const withIndex = existing();
    withIndex[1].indexes.push({ key: 'by_household_debt', type: 'key', columns: ['householdId'], orders: [] });
    expect(() => withDebtSchema(withIndex, team)).toThrow(/by_household_debt/);
  });

  it('refuses when transactions is missing', () => {
    expect(() => withDebtSchema(existing().slice(0, 1), team)).toThrow(/transactions/);
  });
});

describe('migrate-appwrite.mjs integration (static, never executed)', () => {
  const source = readFileSync(migrateScript, 'utf8');

  it('parses as valid JavaScript without running (node --check)', () => {
    expect(() => execFileSync(process.execPath, ['--check', migrateScript], { stdio: 'pipe' })).not.toThrow();
  });

  it('imports the debt schema and builds its table list through withDebtSchema', () => {
    expect(source).toMatch(/from '\.\/lib\/debt-schema\.mjs'/);
    expect(source).toMatch(/withDebtSchema\(/);
  });

  it('keeps the create-only ensure loops and never drops or deletes resources', () => {
    expect(source).toMatch(/for \(const column of table\.columns\) await ensureColumn/);
    expect(source).toMatch(/for \(const definition of table\.indexes\) await ensureIndex/);
    expect(source).not.toMatch(/method: 'DELETE'/);
  });

  it('new table ids do not collide with the ones the script already defines', () => {
    const ids = [...source.matchAll(/^\s*id: '([a-z_]+)'/gm)].map((match) => match[1]);
    expect(ids).toContain('transactions');
    expect(ids.length).toBeGreaterThanOrEqual(9);
    for (const table of DEBT_TABLES) expect(ids).not.toContain(table.id);
  });
});
