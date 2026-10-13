import { Query } from 'appwrite';
import { commitPlan, planCommit } from '@finance-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Replace every networked SDK class with an in-memory fake; keep the pure Query/Permission/Role/ID builders.
vi.mock('appwrite', async (importOriginal) => {
  const actual = await importOriginal();
  class FakeClient { setEndpoint() { return this; } setProject() { return this; } }
  class FakeAccount { constructor() { this.get = vi.fn(); } }
  class FakeStorage {
    constructor() {
      this.createFile = vi.fn();
      this.getFileView = vi.fn();
      this.getFilePreview = vi.fn();
    }
  }
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

describe('listAttachments', () => {
  it('lists the household attachments of one transaction with view and preview URLs', async () => {
    api.tablesDB.listRows.mockResolvedValueOnce({
      rows: [{ $id: 'a1', transactionId: 't1', fileId: 'f1', mimeType: 'image/png', originalName: 'ticket.png' }],
    });
    api.storage.getFileView.mockReturnValue('https://appwrite.test/v1/storage/buckets/receipts/files/f1/view');
    api.storage.getFilePreview.mockReturnValue('https://appwrite.test/v1/storage/buckets/receipts/files/f1/preview');

    const attachments = await api.listAttachments('t1');

    const [{ tableId, queries }] = api.tablesDB.listRows.mock.calls[0];
    expect(tableId).toBe('attachments');
    expect(parse(queries)).toEqual([
      { method: 'equal', attribute: 'householdId', values: ['household-test'] },
      { method: 'equal', attribute: 'transactionId', values: ['t1'] },
      { method: 'limit', values: [100] },
    ]);
    expect(api.storage.getFileView).toHaveBeenCalledWith({ bucketId: 'receipts', fileId: 'f1' });
    expect(api.storage.getFilePreview).toHaveBeenCalledWith({ bucketId: 'receipts', fileId: 'f1', width: 640, height: 640 });
    expect(attachments).toEqual([{
      $id: 'a1',
      transactionId: 't1',
      fileId: 'f1',
      mimeType: 'image/png',
      originalName: 'ticket.png',
      viewUrl: 'https://appwrite.test/v1/storage/buckets/receipts/files/f1/view',
      previewUrl: 'https://appwrite.test/v1/storage/buckets/receipts/files/f1/preview',
    }]);
  });

  it('returns an empty list when the transaction has no receipts', async () => {
    api.tablesDB.listRows.mockResolvedValueOnce({ rows: [] });

    await expect(api.listAttachments('t2')).resolves.toEqual([]);
    expect(api.storage.getFileView).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Debt data layer (debt-management S4)
// ---------------------------------------------------------------------------

const TEAM = 'team:team-test';
const conflict = () => Object.assign(new Error('Document with the requested ID already exists.'), { code: 409 });
const missing = () => Object.assign(new Error('Document not found'), { code: 404 });
const serverError = () => Object.assign(new Error('Server error'), { code: 500 });
const resetTablesDB = () => {
  for (const fn of Object.values(api.tablesDB)) fn.mockReset();
};

describe('debt tables', () => {
  beforeEach(resetTablesDB);

  it('registers the debts and debt_events tables without touching the existing ones', () => {
    expect(api.TABLES).toEqual({
      households: 'households',
      members: 'household_members',
      categories: 'categories',
      transactions: 'transactions',
      budgets: 'budgets',
      goals: 'goals',
      attachments: 'attachments',
      debts: 'debts',
      debtEvents: 'debt_events',
    });
  });

  it('listDebts pages through the household debts', async () => {
    api.tablesDB.listRows.mockResolvedValueOnce({ rows: [{ $id: 'db1' }, { $id: 'db2' }] });

    const result = await api.listDebts();

    expect(result.map((row) => row.$id)).toEqual(['db1', 'db2']);
    const [{ tableId, queries }] = api.tablesDB.listRows.mock.calls[0];
    expect(tableId).toBe('debts');
    expect(parse(queries)).toEqual([
      { method: 'equal', attribute: 'householdId', values: ['household-test'] },
      { method: 'limit', values: [100] },
    ]);
  });

  it('listDebtEvents lists every event, or only those of one debt', async () => {
    api.tablesDB.listRows.mockResolvedValue({ rows: [{ $id: 'e1' }] });

    await api.listDebtEvents();
    await api.listDebtEvents('db1');

    const [all, one] = api.tablesDB.listRows.mock.calls.map(([params]) => params);
    expect(all.tableId).toBe('debt_events');
    expect(parse(all.queries)).toEqual([
      { method: 'equal', attribute: 'householdId', values: ['household-test'] },
      { method: 'limit', values: [100] },
    ]);
    expect(one.tableId).toBe('debt_events');
    expect(parse(one.queries)).toEqual([
      { method: 'equal', attribute: 'householdId', values: ['household-test'] },
      { method: 'equal', attribute: 'debtId', values: ['db1'] },
      { method: 'limit', values: [100] },
    ]);
  });

  it('createDebt writes the given id with team read and update only (no delete)', async () => {
    api.tablesDB.createRow.mockResolvedValueOnce({ $id: 'dbn1' });

    const row = await api.createDebt({ id: 'dbn1', data: { householdId: 'household-test', name: 'Libranza' } });

    expect(row).toEqual({ $id: 'dbn1' });
    expect(api.tablesDB.createRow).toHaveBeenCalledWith({
      databaseId: 'db-test',
      tableId: 'debts',
      rowId: 'dbn1',
      data: { householdId: 'household-test', name: 'Libranza' },
      permissions: [`read("${TEAM}")`, `update("${TEAM}")`],
    });
  });

  it('createDebt without an id generates a unique one', async () => {
    api.tablesDB.createRow.mockResolvedValue({ $id: 'x' });

    await api.createDebt({ data: { name: 'Tarjeta' } });
    await api.createDebt({ data: { name: 'Tarjeta 2' } });

    const [first, second] = api.tablesDB.createRow.mock.calls.map(([params]) => params.rowId);
    expect(typeof first).toBe('string');
    expect(first.length).toBeGreaterThan(0);
    expect(second).not.toBe(first);
  });

  it('createDebtEvent is append-only: team read permission and nothing else', async () => {
    api.tablesDB.createRow.mockResolvedValueOnce({ $id: 'ev1' });

    await api.createDebtEvent({ id: 'ev1', data: { debtId: 'db1', kind: 'payment', dedupeKey: 'web:n1' } });

    const [params] = api.tablesDB.createRow.mock.calls[0];
    expect(params).toEqual({
      databaseId: 'db-test',
      tableId: 'debt_events',
      rowId: 'ev1',
      data: { debtId: 'db1', kind: 'payment', dedupeKey: 'web:n1' },
      permissions: [`read("${TEAM}")`],
    });
  });

  it('createDebtEvent surfaces a duplicate dedupeKey as a 409 conflict', async () => {
    api.tablesDB.createRow.mockRejectedValueOnce(conflict());

    await expect(api.createDebtEvent({ id: 'ev2', data: { dedupeKey: 'web:n1' } })).rejects.toMatchObject({ code: 409 });
  });

  it('findDebtEventByDedupe returns the stored event, or null when none exists', async () => {
    api.tablesDB.listRows
      .mockResolvedValueOnce({ rows: [{ $id: 'ev1', dedupeKey: 'web:n1' }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(api.findDebtEventByDedupe('web:n1')).resolves.toEqual({ $id: 'ev1', dedupeKey: 'web:n1' });
    await expect(api.findDebtEventByDedupe('web:other')).resolves.toBeNull();

    const [{ tableId, queries }] = api.tablesDB.listRows.mock.calls[0];
    expect(tableId).toBe('debt_events');
    expect(parse(queries)).toEqual([
      { method: 'equal', attribute: 'householdId', values: ['household-test'] },
      { method: 'equal', attribute: 'dedupeKey', values: ['web:n1'] },
      { method: 'limit', values: [1] },
    ]);
  });
});

describe('debt cost rows (transactions)', () => {
  beforeEach(resetTablesDB);

  it('createCostRow writes the deterministic id with team read, update and delete', async () => {
    api.tablesDB.createRow.mockResolvedValueOnce({ $id: 'dcev1' });

    await api.createCostRow({ id: 'dcev1', data: { debtId: 'db1', type: 'expense', amountMinor: 190876 } });

    expect(api.tablesDB.createRow).toHaveBeenCalledWith({
      databaseId: 'db-test',
      tableId: 'transactions',
      rowId: 'dcev1',
      data: { debtId: 'db1', type: 'expense', amountMinor: 190876 },
      permissions: [`read("${TEAM}")`, `update("${TEAM}")`, `delete("${TEAM}")`],
    });
  });

  it('createCostRow surfaces a 409 as a conflict and any other error unchanged', async () => {
    api.tablesDB.createRow.mockRejectedValueOnce(conflict()).mockRejectedValueOnce(serverError());

    await expect(api.createCostRow({ id: 'dcev1', data: {} })).rejects.toMatchObject({ code: 409 });
    await expect(api.createCostRow({ id: 'dcev2', data: {} })).rejects.toMatchObject({ code: 500 });
  });

  it('updateCostRow updates only the given fields of that row', async () => {
    api.tablesDB.updateRow.mockResolvedValueOnce({ $id: 'dcev1' });

    await api.updateCostRow('dcev1', { amountMinor: 200000 });

    expect(api.tablesDB.updateRow).toHaveBeenCalledWith({
      databaseId: 'db-test', tableId: 'transactions', rowId: 'dcev1', data: { amountMinor: 200000 },
    });
  });

  it('deleteCostRow deletes the row and treats a missing row (404) as success', async () => {
    api.tablesDB.deleteRow.mockResolvedValueOnce({}).mockRejectedValueOnce(missing());

    await expect(api.deleteCostRow('dcev1')).resolves.toBeUndefined();
    await expect(api.deleteCostRow('dcgone')).resolves.toBeUndefined();

    expect(api.tablesDB.deleteRow).toHaveBeenNthCalledWith(1, { databaseId: 'db-test', tableId: 'transactions', rowId: 'dcev1' });
    expect(api.tablesDB.deleteRow).toHaveBeenNthCalledWith(2, { databaseId: 'db-test', tableId: 'transactions', rowId: 'dcgone' });
  });

  it('deleteCostRow does not swallow other failures', async () => {
    api.tablesDB.deleteRow.mockRejectedValueOnce(serverError());

    await expect(api.deleteCostRow('dcev1')).rejects.toMatchObject({ code: 500 });
  });

  it('listCostRows filters the household transactions by debtId', async () => {
    api.tablesDB.listRows.mockResolvedValueOnce({ rows: [{ $id: 'dcev1' }, { $id: 'dcev2' }] });

    const result = await api.listCostRows('db1');

    expect(result.map((row) => row.$id)).toEqual(['dcev1', 'dcev2']);
    const [{ tableId, queries }] = api.tablesDB.listRows.mock.calls[0];
    expect(tableId).toBe('transactions');
    expect(parse(queries)).toEqual([
      { method: 'equal', attribute: 'householdId', values: ['household-test'] },
      { method: 'equal', attribute: 'debtId', values: ['db1'] },
      { method: 'limit', values: [100] },
    ]);
  });
});

describe('ensureCostCategory', () => {
  beforeEach(resetTablesDB);

  it('reuses an existing category found by folded name (case, accents and spaces ignored)', async () => {
    api.tablesDB.listRows.mockResolvedValueOnce({
      rows: [{ $id: 'c1', name: 'Hogar' }, { $id: 'c2', name: '  COSTÓS Financieros ' }],
    });

    await expect(api.ensureCostCategory('household-test')).resolves.toBe('c2');
    expect(api.tablesDB.createRow).not.toHaveBeenCalled();
    expect(api.tablesDB.listRows.mock.calls[0][0].tableId).toBe('categories');
  });

  it('creates "Costos financieros" (need, palette color, known icon) with id cf{householdId}', async () => {
    api.tablesDB.listRows.mockResolvedValueOnce({ rows: [{ $id: 'c1', name: 'Hogar' }] });
    api.tablesDB.createRow.mockResolvedValueOnce({ $id: 'cfhousehold-test' });

    await expect(api.ensureCostCategory('household-test')).resolves.toBe('cfhousehold-test');

    expect(api.tablesDB.createRow).toHaveBeenCalledWith({
      databaseId: 'db-test',
      tableId: 'categories',
      rowId: 'cfhousehold-test',
      data: { householdId: 'household-test', name: 'Costos financieros', kind: 'need', color: '#7A5AF8', icon: 'receipt', archived: false },
      permissions: [`read("${TEAM}")`, `update("${TEAM}")`],
    });
  });

  it('keeps the generated id within the 36 characters Appwrite allows', async () => {
    api.tablesDB.listRows.mockResolvedValueOnce({ rows: [] });
    api.tablesDB.createRow.mockImplementationOnce(async (params) => ({ $id: params.rowId }));

    const id = await api.ensureCostCategory('h'.repeat(36));

    expect(id).toHaveLength(36);
    expect(id.startsWith('cfhhhh')).toBe(true);
  });

  it('re-reads the categories when a concurrent client already created it (409)', async () => {
    api.tablesDB.listRows
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ $id: 'cfhousehold-test', name: 'Costos financieros' }] });
    api.tablesDB.createRow.mockRejectedValueOnce(conflict());

    await expect(api.ensureCostCategory('household-test')).resolves.toBe('cfhousehold-test');
    expect(api.tablesDB.listRows).toHaveBeenCalledTimes(2);
  });

  it('fails when the 409 is not explained by a category that can be read back', async () => {
    api.tablesDB.listRows.mockResolvedValue({ rows: [] });
    api.tablesDB.createRow.mockRejectedValueOnce(conflict());

    await expect(api.ensureCostCategory('household-test')).rejects.toMatchObject({ code: 409 });
  });

  it('does not hide other creation errors', async () => {
    api.tablesDB.listRows.mockResolvedValueOnce({ rows: [] });
    api.tablesDB.createRow.mockRejectedValueOnce(serverError());

    await expect(api.ensureCostCategory('household-test')).rejects.toMatchObject({ code: 500 });
  });
});

describe('debtPort (the commitPlan port contract)', () => {
  const debt = {
    $id: 'dbn1',
    householdId: 'household-test',
    name: 'Crédito Vehículo',
    ownerScope: 'partner',
    terms: {
      kind: 'consumer', principalMinor: 10_000_000, openedOn: '2026-01-15',
      rate: { value: 24, basis: 'effective', periodicity: 'annual', timing: 'arrears' },
      system: 'french', periodicity: 'monthly', n: 36, firstDueOn: '2026-02-15',
      charges: [{ id: 'fee', kind: 'fee', label: 'Admin fee', basis: 'fixed', value: 10_000 }],
    },
  };
  const paymentPlan = () => planCommit(
    debt,
    [],
    { kind: 'payment', effectiveOn: '2026-02-15', amountMinor: 390_381 },
    { eventId: 'ev1', dedupeKey: 'web:n1', actorId: 'u1', source: 'web' },
  );

  beforeEach(resetTablesDB);

  it('exposes exactly the operations commitPlan calls', () => {
    const port = api.debtPort();

    expect(Object.keys(port).sort()).toEqual(['createCostRow', 'createEvent', 'deleteCostRow', 'ensureCostCategory', 'findEventByDedupe']);
    for (const operation of Object.values(port)) expect(typeof operation).toBe('function');
  });

  it('commits a payment: category, event, then the cost row dc{eventId}, with the right permissions', async () => {
    api.tablesDB.listRows.mockResolvedValue({ rows: [] });
    api.tablesDB.createRow.mockImplementation(async (params) => ({ $id: params.rowId, ...params.data }));

    const result = await commitPlan(api.debtPort(), paymentPlan());

    expect(result.duplicate).toBe(false);
    const writes = api.tablesDB.createRow.mock.calls.map(([params]) => [params.tableId, params.rowId]);
    expect(writes).toEqual([['categories', 'cfhousehold-test'], ['debt_events', 'ev1'], ['transactions', 'dcev1']]);
    const [, eventCall, costCall] = api.tablesDB.createRow.mock.calls.map(([params]) => params);
    expect(eventCall.permissions).toEqual([`read("${TEAM}")`]);
    expect(eventCall.data).toMatchObject({ debtId: 'dbn1', kind: 'payment', dedupeKey: 'web:n1', amountMinor: 390_381 });
    expect(costCall.permissions).toEqual([`read("${TEAM}")`, `update("${TEAM}")`, `delete("${TEAM}")`]);
    expect(costCall.data).toMatchObject({ debtId: 'dbn1', source: 'debt', amountMinor: 190_876, categoryId: 'cfhousehold-test', ownerScope: 'partner' });
  });

  it('a retry of the same plan is idempotent: both 409s are absorbed and the stored event is returned', async () => {
    api.tablesDB.listRows.mockImplementation(async ({ tableId }) => ({
      rows: tableId === 'categories'
        ? [{ $id: 'cat1', name: 'Costos financieros' }]
        : [{ $id: 'ev1', dedupeKey: 'web:n1', debtId: 'dbn1' }],
    }));
    api.tablesDB.createRow.mockRejectedValue(conflict());

    const result = await commitPlan(api.debtPort(), paymentPlan());

    expect(result.duplicate).toBe(true);
    expect(result.event.$id).toBe('ev1');
    expect(result.costRow).toMatchObject({ $id: 'dcev1', categoryId: 'cat1' });
    const created = api.tablesDB.createRow.mock.calls.map(([params]) => params.tableId);
    expect(created).toEqual(['debt_events', 'transactions']);
  });

  it('voiding deletes the dc{target} row and tolerates it already being gone', async () => {
    const stored = { $id: 'ev1', ...paymentPlan().event.data };
    api.tablesDB.listRows.mockResolvedValue({ rows: [] });
    api.tablesDB.createRow.mockImplementation(async (params) => ({ $id: params.rowId, ...params.data }));
    api.tablesDB.deleteRow.mockRejectedValueOnce(missing());
    const voidPlan = planCommit(
      debt,
      [stored],
      { kind: 'void', effectiveOn: '2026-02-16', targetEventId: 'ev1', reason: 'typo' },
      { eventId: 'ev2', actorId: 'u1', source: 'web' },
    );

    await commitPlan(api.debtPort(), voidPlan);

    expect(api.tablesDB.deleteRow).toHaveBeenCalledWith({ databaseId: 'db-test', tableId: 'transactions', rowId: 'dcev1' });
    expect(api.tablesDB.createRow.mock.calls[0][0]).toMatchObject({ tableId: 'debt_events', rowId: 'ev2' });
  });
});
