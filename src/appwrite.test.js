import { Query } from 'appwrite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Replace every networked SDK class with an in-memory fake; keep the pure Query/Permission/Role/ID builders.
vi.mock('appwrite', async (importOriginal) => {
  const actual = await importOriginal();
  class FakeClient { setEndpoint() { return this; } setProject() { return this; } }
  class FakeAccount { constructor() { this.get = vi.fn(); } }
  class FakeStorage { constructor() { this.createFile = vi.fn(); } }
  class FakeTablesDB {
    constructor() {
      this.listRows = vi.fn();
      this.getRow = vi.fn();
      this.createRow = vi.fn();
      this.updateRow = vi.fn();
      this.upsertRow = vi.fn();
      this.deleteRow = vi.fn();
    }
  }
  return { ...actual, Client: FakeClient, Account: FakeAccount, Storage: FakeStorage, TablesDB: FakeTablesDB };
});

const ENV = {
  VITE_APPWRITE_ENDPOINT: 'https://appwrite.test/v1',
  VITE_APPWRITE_PROJECT_ID: 'project-test',
  VITE_APPWRITE_DATABASE_ID: 'db-test',
  VITE_APPWRITE_HOUSEHOLD_ID: 'household-test',
  VITE_APPWRITE_HOUSEHOLD_TEAM_ID: 'team-test',
};

let api;
const parse = (queries) => queries.map((query) => JSON.parse(query));
const rows = (count, offset = 0) => Array.from({ length: count }, (_, index) => ({ $id: `row-${offset + index}` }));

beforeAll(async () => {
  for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
  api = await import('./appwrite');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listAllRows', () => {
  it('follows cursorAfter until a short page arrives', async () => {
    api.tablesDB.listRows
      .mockResolvedValueOnce({ rows: rows(100) })
      .mockResolvedValueOnce({ rows: rows(100, 100) })
      .mockResolvedValueOnce({ rows: rows(7, 200) });

    const result = await api.listAllRows('categories', [Query.orderAsc('name')]);

    expect(result).toHaveLength(207);
    expect(api.tablesDB.listRows).toHaveBeenCalledTimes(3);
    const [first, second, third] = api.tablesDB.listRows.mock.calls.map(([params]) => params);
    expect(first).toMatchObject({ databaseId: 'db-test', tableId: 'categories' });
    expect(parse(first.queries)).toEqual([
      { method: 'equal', attribute: 'householdId', values: ['household-test'] },
      { method: 'orderAsc', attribute: 'name' },
      { method: 'limit', values: [100] },
    ]);
    expect(parse(second.queries)).toContainEqual({ method: 'cursorAfter', values: ['row-99'] });
    expect(parse(third.queries)).toContainEqual({ method: 'cursorAfter', values: ['row-199'] });
  });

  it('stops after an empty first page', async () => {
    api.tablesDB.listRows.mockResolvedValueOnce({ rows: [] });

    await expect(api.listAllRows('goals')).resolves.toEqual([]);
    expect(api.tablesDB.listRows).toHaveBeenCalledTimes(1);
  });

  it('stops when a full page is followed by an empty one', async () => {
    api.tablesDB.listRows.mockResolvedValueOnce({ rows: rows(100) }).mockResolvedValueOnce({ rows: [] });

    await expect(api.listAllRows('budgets')).resolves.toHaveLength(100);
    expect(api.tablesDB.listRows).toHaveBeenCalledTimes(2);
  });
});

describe('getTransactionsInRange', () => {
  it('queries the half-open date range, newest first', async () => {
    api.tablesDB.listRows.mockResolvedValueOnce({ rows: rows(3) });

    const result = await api.getTransactionsInRange('2026-10-01T05:00:00.000Z', '2026-11-01T05:00:00.000Z');

    expect(result).toHaveLength(3);
    const [{ tableId, queries }] = api.tablesDB.listRows.mock.calls[0];
    expect(tableId).toBe('transactions');
    expect(parse(queries)).toEqual([
      { method: 'equal', attribute: 'householdId', values: ['household-test'] },
      { method: 'greaterThanEqual', attribute: 'occurredAt', values: ['2026-10-01T05:00:00.000Z'] },
      { method: 'lessThan', attribute: 'occurredAt', values: ['2026-11-01T05:00:00.000Z'] },
      { method: 'orderDesc', attribute: 'occurredAt' },
      { method: 'limit', values: [100] },
    ]);
  });
});

describe('getWorkspace', () => {
  it('loads every table except transactions through pagination', async () => {
    api.tablesDB.getRow.mockResolvedValueOnce({ $id: 'household-test', name: 'Casa' });
    api.tablesDB.listRows.mockResolvedValue({ rows: [{ $id: 'x', name: 'Mercado' }] });

    const workspace = await api.getWorkspace();

    expect(Object.keys(workspace).sort()).toEqual(['budgets', 'categories', 'goals', 'household', 'members']);
    const tables = api.tablesDB.listRows.mock.calls.map(([params]) => params.tableId).sort();
    expect(tables).toEqual(['budgets', 'categories', 'goals', 'household_members']);
  });
});

describe('createCategory', () => {
  it('creates a team-readable, team-updatable category row', async () => {
    api.tablesDB.createRow.mockResolvedValueOnce({ $id: 'new-category' });

    await api.createCategory({ name: 'Mascotas', kind: 'need', color: '#7A5AF8', icon: 'sparkles' });

    const [params] = api.tablesDB.createRow.mock.calls[0];
    expect(params).toMatchObject({
      databaseId: 'db-test',
      tableId: 'categories',
      data: { householdId: 'household-test', name: 'Mascotas', kind: 'need', color: '#7A5AF8', icon: 'sparkles', archived: false },
      permissions: ['read("team:team-test")', 'update("team:team-test")'],
    });
    expect(typeof params.rowId).toBe('string');
  });

  it('omits an empty icon', async () => {
    api.tablesDB.createRow.mockResolvedValueOnce({ $id: 'new-category' });

    await api.createCategory({ name: 'Varios', kind: 'income', color: '#0B6E4F', icon: '' });

    expect(api.tablesDB.createRow.mock.calls[0][0].data).not.toHaveProperty('icon');
  });
});

describe('updateGoal', () => {
  it('updates only the given goal fields', async () => {
    api.tablesDB.updateRow.mockResolvedValueOnce({ $id: 'goal-1' });

    await api.updateGoal('goal-1', { currentMinor: 9000000 });

    expect(api.tablesDB.updateRow).toHaveBeenCalledWith({
      databaseId: 'db-test', tableId: 'goals', rowId: 'goal-1', data: { currentMinor: 9000000 },
    });
  });
});
