import { describe, expect, it } from 'vitest';
import { buildBudgetMonth, canEditBudget, dashboardCategoryStats, movementCounts, resolveBudgetLines } from './budgetMonth';

const ok = (rows) => ({ rows, status: 'ok' });
const LEGACY_ROW = { $id: 'b1', month: '2026-10', categoryId: 'c1', plannedMinor: 8000 };
const LINE = { $id: 'bo1', targetType: 'category', targetId: 'c1', rule: 'fixed', amountMinor: 5000, percentBp: null, fromMonth: '2026-10', toMonth: null };

describe('resolveBudgetLines', () => {
  it('is legacy when budget_lines is missing, with lines from the legacy budgets', () => {
    const result = resolveBudgetLines({ budgetLines: { rows: [], status: 'missing' }, budgets: [LEGACY_ROW] });
    expect(result.linesMode).toBe('legacy');
    expect(result.lines.map((line) => [line.$id, line.targetId, line.amountMinor])).toEqual([['blb1', 'c1', 8000]]);
  });

  it('is legacy when the table is empty but budgets still has rows', () => {
    const result = resolveBudgetLines({ budgetLines: ok([]), budgets: [LEGACY_ROW] });
    expect(result.linesMode).toBe('legacy');
    expect(result.lines).toHaveLength(1);
  });

  it('is lines for an empty table when every legacy row is one the migration skips (zero amounts)', () => {
    const zero = { ...LEGACY_ROW, $id: 'b0', plannedMinor: 0 };
    expect(resolveBudgetLines({ budgetLines: ok([]), budgets: [zero, { ...zero, $id: 'b9' }] })).toMatchObject({ linesMode: 'lines', lines: [] });
  });

  it('is lines for an empty table with no legacy rows (new household)', () => {
    expect(resolveBudgetLines({ budgetLines: ok([]), budgets: [] })).toMatchObject({ linesMode: 'lines', lines: [] });
  });

  it('is lines with the stored rows once the table has data, ignoring budgets', () => {
    const result = resolveBudgetLines({ budgetLines: ok([LINE]), budgets: [LEGACY_ROW] });
    expect(result).toMatchObject({ linesMode: 'lines', lines: [LINE] });
  });

  it('treats an absent workspace field as missing and never throws', () => {
    expect(resolveBudgetLines({ budgetLines: undefined, budgets: undefined })).toMatchObject({ linesMode: 'legacy', lines: [], linesStatus: 'missing' });
  });

  it('falls back to legacy when the table is unavailable and reports the status', () => {
    const result = resolveBudgetLines({ budgetLines: { rows: [], status: 'unavailable' }, budgets: [LEGACY_ROW] });
    expect(result).toMatchObject({ linesMode: 'legacy', linesStatus: 'unavailable' });
    expect(result.lines).toHaveLength(1);
  });
});

describe('canEditBudget', () => {
  it('needs the total scope, lines mode and a readable table', () => {
    expect(canEditBudget({ scope: 'total', linesMode: 'lines', linesStatus: 'ok' })).toBe(true);
    expect(canEditBudget({ scope: 'you', linesMode: 'lines', linesStatus: 'ok' })).toBe(false);
    expect(canEditBudget({ scope: 'total', linesMode: 'legacy', linesStatus: 'ok' })).toBe(false);
    expect(canEditBudget({ scope: 'total', linesMode: 'lines', linesStatus: 'unavailable' })).toBe(false);
  });
});

describe('buildBudgetMonth', () => {
  const categories = [
    { $id: 'c1', name: 'Mercado', kind: 'need', color: '#0B6E4F' },
    { $id: 'c2', name: 'Salario', kind: 'income' },
  ];
  const expense = { $id: 't1', type: 'expense', categoryId: 'c1', amountMinor: 3000, occurredAt: '2026-10-05T12:00:00.000Z' };
  const income = { $id: 't2', type: 'income', categoryId: 'c2', amountMinor: 100000, occurredAt: '2026-10-01T12:00:00.000Z' };
  const previousIncome = { $id: 't0', type: 'income', categoryId: 'c2', amountMinor: 90000, occurredAt: '2026-09-28T12:00:00.000Z' };
  const olderIncome = { $id: 'tx', type: 'income', categoryId: 'c2', amountMinor: 70000, occurredAt: '2026-08-28T12:00:00.000Z' };
  const base = { month: '2026-10', lines: [LINE], categories, transactions: [expense, income], history: [olderIncome, previousIncome], debts: ok([]), debtEvents: ok([]) };

  it('computes planned and actual per category from the lines and the month transactions', () => {
    const month = buildBudgetMonth(base);
    expect(month.groups.need.categories[0]).toMatchObject({ categoryId: 'c1', plannedMinor: 5000, actualMinor: 3000, remainingMinor: 2000 });
    expect(month.base).toEqual({ incomeMinor: 100000, source: 'actual' });
  });

  it('uses only the previous month income as the reference when the month has none', () => {
    const month = buildBudgetMonth({ ...base, transactions: [expense] });
    expect(month.base).toEqual({ incomeMinor: 90000, source: 'reference' });
  });

  it('applies the scope filter to the reference income too', () => {
    const mine = { ...previousIncome, ownerScope: 'you' };
    const theirs = { ...previousIncome, $id: 't9', ownerScope: 'partner', amountMinor: 40000 };
    const month = buildBudgetMonth({ ...base, transactions: [], history: [mine, theirs], inScope: (item) => item.ownerScope === 'you' });
    expect(month.base).toEqual({ incomeMinor: 90000, source: 'reference' });
  });

  it('passes null debt events when the debt data is not ok, flagging the warning', () => {
    const unavailable = buildBudgetMonth({ ...base, debtEvents: { rows: [], status: 'unavailable' } });
    expect(unavailable.warnings).toContainEqual({ code: 'debt_data_unavailable' });
    expect(buildBudgetMonth(base).warnings).not.toContainEqual({ code: 'debt_data_unavailable' });
  });
});

describe('dashboardCategoryStats', () => {
  it('derives the per-category stats the dashboard donut reads', () => {
    const categories = [{ $id: 'c1', name: 'Mercado', kind: 'need', color: '#0B6E4F' }, { $id: 'c2', name: 'Salario', kind: 'income' }];
    const month = buildBudgetMonth({
      month: '2026-10', lines: [LINE], categories, history: [], debts: ok([]), debtEvents: ok([]),
      transactions: [{ $id: 't1', type: 'expense', categoryId: 'c1', amountMinor: 3000, occurredAt: '2026-10-05T12:00:00.000Z' }],
    });
    const categoryStats = dashboardCategoryStats(month, categories);
    expect(categoryStats).toHaveLength(1);
    expect(categoryStats[0]).toMatchObject({ $id: 'c1', name: 'Mercado', value: 3000, budget: 5000 });
  });
});

describe('movementCounts', () => {
  const categories = new Map([['n', { kind: 'need' }], ['w', { kind: 'want' }], ['s', { kind: 'saving' }]]);
  const tx = (type, categoryId, extra = {}) => ({ type, categoryId, ...extra });

  it('counts income and only consumption expenses (need and want), skipping saving, debt and transfers', () => {
    const rows = [tx('income', 'x'), tx('expense', 'n'), tx('expense', 'w'), tx('expense', 's'), tx('expense', 'n', { debtId: 'd1' }), tx('transfer', 'n')];
    expect(movementCounts(rows, categories)).toEqual({ income: 1, consumption: 2 });
  });
});
