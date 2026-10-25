// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { computeBudgetMonth, lineIds, linesFromLegacyBudgets } from '../../packages/finance-core/index.js';
import { LEGACY_REFUSAL, budgetFigures, budgetWindow, budgetWrites, loadBudgetMonth, planBudgetEdit } from './budget.js';
import { pesos } from './debt/format.js';

const TZ = 'America/Bogota';
const MONTH = '2026-10';
const HH = 'hh1';
const categories = [
  { $id: 'c-mercado', name: 'Mercado', kind: 'need' },
  { $id: 'c-ocio', name: 'Ocio', kind: 'want' },
  { $id: 'c-bolsa', name: 'Bolsa', kind: 'investment' },
  { $id: 'c-sueldo', name: 'Sueldo', kind: 'income' },
];
const tx = (type, amountMinor, occurredAt, categoryId, extra = {}) => ({ $id: `t${occurredAt}${amountMinor}`, householdId: HH, type, amountMinor, occurredAt, categoryId, ownerScope: 'shared', ...extra });
const transactions = [
  tx('income', 5000000, '2026-10-02T15:00:00.000Z', 'c-sueldo'),
  tx('expense', 600000, '2026-10-05T15:00:00.000Z', 'c-mercado'),
  tx('income', 4000000, '2026-09-02T15:00:00.000Z', 'c-sueldo'),
  tx('expense', 100000, '2026-09-05T15:00:00.000Z', 'c-mercado'),
];
const recurring = { $id: 'br1', householdId: HH, targetType: 'category', targetId: 'c-mercado', rule: 'fixed', amountMinor: 800000, percentBp: null, fromMonth: '2026-01', toMonth: null };

const notFound = Object.assign(new Error('not found'), { code: 404 });
function fakeList(tables, { fail = {} } = {}) {
  const calls = [];
  const listRows = async (table, where, range) => {
    calls.push({ table, where, range });
    if (fail[table]) throw fail[table];
    return tables[table] || [];
  };
  return { listRows, calls };
}
const baseTables = { categories, transactions, budgets: [], budget_lines: [recurring], debts: [], debt_events: [] };
const load = (listRows) => loadBudgetMonth({ listRows, householdId: HH, month: MONTH, timezone: TZ });

describe('budgetWindow', () => {
  it('spans M-1 and M widened by a day each side', () => {
    const window = budgetWindow('2026-10');
    expect(window.previousMonth).toBe('2026-09');
    expect(window.from).toBe('2026-08-31T00:00:00.000Z');
    expect(window.to).toBe('2026-11-02T00:00:00.000Z');
    expect(budgetWindow('2026-01').previousMonth).toBe('2025-12');
  });
});

describe('loadBudgetMonth', () => {
  it('reads the tables through listRows, with the transaction range, and matches computeBudgetMonth', async () => {
    const { listRows, calls } = fakeList(baseTables);
    const result = await load(listRows);
    const expected = computeBudgetMonth({
      month: MONTH, lines: [recurring], categories, transactions: transactions.slice(0, 2), previousMonthIncomeMinor: 4000000, debts: [], debtEvents: [],
    });

    expect(result.linesMode).toBe('lines');
    expect(result.budgetMonth).toEqual(expected);
    expect(result.budgetMonth.totals.porAsignarMinor).toBe(4200000);
    const range = calls.find((call) => call.table === 'transactions').range;
    expect(range).toEqual({ field: 'occurredAt', from: '2026-08-31T00:00:00.000Z', to: '2026-11-02T00:00:00.000Z' });
    expect(calls.map((call) => call.table).sort()).toEqual(['budget_lines', 'budgets', 'categories', 'debt_events', 'debts', 'transactions']);
    expect(calls.every((call) => call.where.householdId === HH)).toBe(true);
  });

  it('uses the previous month income as reference when the month has none', async () => {
    const { listRows } = fakeList({ ...baseTables, transactions: transactions.filter((row) => row.type !== 'income' || row.occurredAt.startsWith('2026-09')) });
    const { budgetMonth } = await load(listRows);

    expect(budgetMonth.base).toEqual({ incomeMinor: 4000000, source: 'reference' });
  });

  it('assigns months with the household time zone and keeps only M for the actuals', async () => {
    const late = tx('expense', 50000, '2026-11-01T03:00:00.000Z', 'c-mercado'); // Oct 31 22:00 in Bogota
    const { budgetMonth } = await load(fakeList({ ...baseTables, transactions: [...transactions, late] }).listRows);

    expect(budgetMonth.groups.need.actualMinor).toBe(650000);
  });

  it('falls back to the legacy rows when budget_lines is missing', async () => {
    const legacy = [{ $id: 'b1', householdId: HH, month: MONTH, categoryId: 'c-mercado', plannedMinor: 700000 }];
    const result = await load(fakeList({ ...baseTables, budgets: legacy }, { fail: { budget_lines: notFound } }).listRows);

    expect(result.linesMode).toBe('legacy');
    expect(result.lines).toEqual(linesFromLegacyBudgets(legacy));
    expect(result.budgetMonth.groups.need.allocatedMinor).toBe(700000);
  });

  it('falls back when budget_lines is empty but budgets has rows, and stays in lines mode when both are empty', async () => {
    const legacy = [{ $id: 'b1', householdId: HH, month: MONTH, categoryId: 'c-mercado', plannedMinor: 700000 }];
    const withLegacy = await load(fakeList({ ...baseTables, budget_lines: [], budgets: legacy }).listRows);
    const empty = await load(fakeList({ ...baseTables, budget_lines: [] }).listRows);

    expect(withLegacy.linesMode).toBe('legacy');
    expect(empty.linesMode).toBe('lines');
    expect(empty.lines).toEqual([]);
  });

  it('treats an unreadable budget_lines as legacy and an unreadable legacy table as empty', async () => {
    const broken = Object.assign(new Error('boom'), { code: 500 });
    const result = await load(fakeList(baseTables, { fail: { budget_lines: broken, budgets: broken } }).listRows);

    expect(result.linesMode).toBe('legacy');
    expect(result.lines).toEqual([]);
  });

  it('passes debtEvents null and surfaces debt_data_unavailable when the debt tables cannot be read', async () => {
    const { budgetMonth } = await load(fakeList(baseTables, { fail: { debt_events: notFound } }).listRows);

    expect(budgetMonth.warnings).toContainEqual({ code: 'debt_data_unavailable' });
  });

  it('counts debt payments of the month in the debt group', async () => {
    const debts = [{ $id: 'd1', householdId: HH, ownerScope: 'shared' }];
    const events = [{ $id: 'e1', debtId: 'd1', kind: 'payment', effectiveOn: '2026-10-10', amountMinor: 300000, createdAt: '2026-10-10T10:00:00.000Z' }];
    const { budgetMonth } = await load(fakeList({ ...baseTables, debts, debt_events: events }).listRows);

    expect(budgetMonth.groups.debt.actualMinor).toBe(300000);
    expect(budgetMonth.warnings.some((warning) => warning.code === 'debt_data_unavailable')).toBe(false);
  });

  it('propagates a failure of the core tables', async () => {
    await expect(load(fakeList(baseTables, { fail: { transactions: new Error('down') } }).listRows)).rejects.toThrow('down');
  });
});

describe('planBudgetEdit', () => {
  const ctx = { actorId: 'u1', source: 'nia' };
  const draft = { action: 'set', categoryId: 'c-mercado', amountMinor: 900000, month: MONTH };
  const input = (over = {}) => ({ draft, lines: [recurring], linesMode: 'lines', categories, ctx, ...over });

  it('previews a set naming the category, the amount and "solo este mes", with no writes', () => {
    const result = planBudgetEdit(input());

    expect(result.ok).toBe(true);
    expect(result.text).toContain('Mercado');
    expect(result.text).toContain(pesos(900000));
    expect(result.text).toContain('solo este mes');
    expect(result.text).toContain('no se guarda hasta que confirmes');
  });

  it('creates exactly one bo line and leaves the open-ended plan alone', () => {
    const { plan } = planBudgetEdit(input());
    const target = { targetType: 'category', targetId: 'c-mercado' };

    expect(plan.updates).toEqual([]);
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0].id).toBe(lineIds.override(target, MONTH));
    expect(plan.creates[0].data).toMatchObject({ ...target, rule: 'fixed', amountMinor: 900000, fromMonth: MONTH, toMonth: MONTH, actorId: 'u1', source: 'nia' });
  });

  it('updates the existing one-month line whatever its id, with no duplicate', () => {
    const migrated = { $id: 'blXYZ', householdId: HH, targetType: 'category', targetId: 'c-mercado', rule: 'fixed', amountMinor: 700000, percentBp: null, fromMonth: MONTH, toMonth: MONTH };
    const { plan } = planBudgetEdit(input({ lines: [recurring, migrated], draft: { ...draft, amountMinor: 950000 } }));

    expect(plan.creates).toEqual([]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toMatchObject({ id: 'blXYZ', data: { amountMinor: 950000 } });
  });

  it('writes a one-month tombstone for a remove and keeps the recurring line', () => {
    const result = planBudgetEdit(input({ draft: { action: 'remove', categoryId: 'c-mercado', month: MONTH } }));

    expect(result.plan.updates).toEqual([]);
    expect(result.plan.creates).toHaveLength(1);
    expect(result.plan.creates[0].data).toMatchObject({ amountMinor: 0, fromMonth: MONTH, toMonth: MONTH });
    expect(result.text).toContain('solo este mes');
    expect(result.text).toContain('Mercado');
  });

  it('accepts investment categories', () => {
    expect(planBudgetEdit(input({ draft: { ...draft, categoryId: 'c-bolsa' } })).ok).toBe(true);
  });

  it('rejects income categories, unknown categories, bad amounts and debt-kind categories', () => {
    expect(planBudgetEdit(input({ draft: { ...draft, categoryId: 'c-sueldo' } }))).toMatchObject({ ok: false, issue: 'income_category' });
    expect(planBudgetEdit(input({ draft: { ...draft, categoryId: 'zz' } }))).toMatchObject({ ok: false, issue: 'unknown_category' });
    expect(planBudgetEdit(input({ draft: { ...draft, amountMinor: 0 } }))).toMatchObject({ ok: false, issue: 'invalid_amount' });
    expect(planBudgetEdit(input({ draft: { ...draft, amountMinor: 12.5 } }))).toMatchObject({ ok: false, issue: 'invalid_amount' });
    const withDebt = [...categories, { $id: 'c-debt', name: 'Intereses', kind: 'debt' }];
    expect(planBudgetEdit(input({ categories: withDebt, draft: { ...draft, categoryId: 'c-debt' } }))).toMatchObject({ ok: false, issue: 'debt_category' });
  });

  it('refuses writes in legacy mode with the migration-pending message', () => {
    const result = planBudgetEdit(input({ linesMode: 'legacy' }));

    expect(result).toEqual({ ok: false, issue: 'legacy_mode', text: LEGACY_REFUSAL });
    expect(LEGACY_REFUSAL).toContain('migrate:budgets');
    expect(LEGACY_REFUSAL).toContain('migrate:appwrite');
  });
});

describe('budgetWrites', () => {
  it('orders updates before creates, targets budget_lines only and stamps the household', () => {
    const plan = {
      ok: true,
      updates: [{ id: 'u', data: { amountMinor: 1 } }],
      creates: [{ id: 'c', data: { amountMinor: 2 } }],
    };

    expect(budgetWrites(plan, HH)).toEqual([
      { op: 'update', table: 'budget_lines', id: 'u', data: { amountMinor: 1, householdId: HH } },
      { op: 'create', table: 'budget_lines', id: 'c', data: { amountMinor: 2, householdId: HH } },
    ]);
  });
});

describe('budgetFigures', () => {
  it('hands the replies the code-computed allocated, actual and Por asignar', () => {
    const budgetMonth = computeBudgetMonth({ month: MONTH, lines: [recurring], categories, transactions: transactions.slice(0, 2), previousMonthIncomeMinor: 0 });
    const figures = budgetFigures(budgetMonth);

    expect(figures.month).toBe(MONTH);
    expect(figures.porAsignarMinor).toBe(budgetMonth.totals.porAsignarMinor);
    expect(figures.allocatedMinor).toBe(800000);
    expect(figures.incomeSource).toBe('actual');
    expect(figures.groups.find((group) => group.group === 'need')).toEqual({ group: 'need', allocatedMinor: 800000, actualMinor: 600000, remainingMinor: 200000 });
    expect(figures.warnings).toEqual(budgetMonth.warnings);
    expect(figures.groups.map((group) => group.group)).toEqual(['need', 'want', 'saving', 'investment', 'debt']);
  });

  it('reports a reference income base and over-allocation', () => {
    const budgetMonth = computeBudgetMonth({ month: MONTH, lines: [recurring], categories, transactions: [], previousMonthIncomeMinor: 500000 });

    expect(budgetFigures(budgetMonth)).toMatchObject({ incomeSource: 'reference', porAsignarMinor: -300000 });
  });
});
