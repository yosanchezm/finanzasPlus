// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { computeBudgetMonth } from '../../src/budget/compute.js';
import { roundUnit } from '../../src/money.js';

const MONTH = '2026-10';
const cat = (id, kind, extra) => ({ $id: id, name: id.toUpperCase(), color: '#111', kind, archived: false, ...extra });
const categories = [cat('salario', 'income'), cat('arriendo', 'need'), cat('mercado', 'need'), cat('ocio', 'want'), cat('ahorro', 'saving'), cat('etf', 'investment'), cat('cuotas', 'debt'), cat('viejo', 'need', { archived: true })];
const tx = (type, amountMinor, categoryId, extra) => ({ type, amountMinor, categoryId, ownerScope: 'you', ...extra });
const income = (amountMinor, extra) => tx('income', amountMinor, 'salario', extra);
const spend = (categoryId, amountMinor, extra) => tx('expense', amountMinor, categoryId, extra);
const line = (id, targetType, targetId, amountMinor, extra) => ({ $id: id, targetType, targetId, rule: 'fixed', amountMinor, percentBp: null, fromMonth: MONTH, toMonth: null, ...extra });
const pct = (id, targetType, targetId, percentBp) => line(id, targetType, targetId, null, { rule: 'percent', percentBp });
const debt = (id, ownerScope = 'you') => ({ $id: id, ownerScope });
const event = (id, kind, amountMinor, extra) => ({ $id: id, debtId: 'd1', kind, effectiveOn: '2026-10-05', amountMinor, payloadJson: '{}', ...extra });
const voidOf = (id, targetEventId) => event(id, 'void', 0, { payloadJson: JSON.stringify({ targetEventId, reason: 'x' }) });
const run = (input) => computeBudgetMonth({ month: MONTH, categories, lines: [], transactions: [], previousMonthIncomeMinor: 0, debts: [debt('d1')], debtEvents: [], ...input });
const rows = (result, group) => result.groups[group].categories;
const row = (result, group, id) => rows(result, group).find((c) => c.categoryId === id);

describe('income base and percent lines', () => {
  it('uses the real month income (actual)', () => {
    const result = run({ transactions: [income(4000000)], lines: [pct('p', 'group', 'saving', 2000)] });
    expect(result.base).toEqual({ incomeMinor: 4000000, source: 'actual' });
    expect(result.groups.saving.allocatedMinor).toBe(800000);
  });

  it('falls back to the previous month (reference) and then to none', () => {
    const lines = [pct('p', 'group', 'saving', 1000)];
    const reference = run({ lines, previousMonthIncomeMinor: 3000000 });
    expect(reference.base).toEqual({ incomeMinor: 3000000, source: 'reference' });
    expect(reference.groups.saving.allocatedMinor).toBe(300000);
    const none = run({ lines });
    expect(none.base).toEqual({ incomeMinor: 0, source: 'none' });
    expect(none.groups.saving.allocatedMinor).toBe(0);
  });

  it('rounds to an integer like roundUnit', () => {
    const result = run({ transactions: [income(3333333)], lines: [pct('p', 'group', 'saving', 1500)] });
    expect(result.groups.saving.allocatedMinor).toBe(roundUnit((3333333 * 1500) / 10000));
    expect(Number.isInteger(result.groups.saving.allocatedMinor)).toBe(true);
  });

  it('ignores transfers and never mutates its inputs', () => {
    const deepFreeze = (value) => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(deepFreeze); } return value; };
    const frozen = deepFreeze({
      categories, debts: [debt('d1')], debtEvents: [event('p1', 'payment', 1)],
      transactions: [income(1000000), tx('transfer', 900000, 'salario'), spend('mercado', 100000)],
      lines: [line('l', 'category', 'mercado', 200000)],
    });
    const result = computeBudgetMonth({ month: MONTH, previousMonthIncomeMinor: 0, ...frozen });
    expect(result.totals.incomeMinor).toBe(1000000);
    expect(result.totals.consumptionMinor).toBe(100000);
  });
});

describe('allocation and warnings', () => {
  it('lets an envelope win over its sub-limits', () => {
    const result = run({ lines: [line('g', 'group', 'want', 500000), line('a', 'category', 'ocio', 200000), line('b', 'category', 'ocio', 250000)] });
    expect(result.groups.want.allocatedMinor).toBe(500000);
    expect(result.groups.want.envelope).toBe(500000);
  });

  it('sums category lines without an envelope and ignores income and archived targets', () => {
    const result = run({ lines: [line('a', 'category', 'arriendo', 300000), line('b', 'category', 'mercado', 400000), line('c', 'category', 'salario', 900000), line('d', 'category', 'viejo', 800000), line('e', 'group', 'income', 700000)] });
    expect(result.groups.need.allocatedMinor).toBe(700000);
    expect(result.totals.allocatedMinor).toBe(700000);
  });

  it('warns when sub-limits exceed the envelope and keeps allocated', () => {
    const result = run({ lines: [line('g', 'group', 'want', 500000), line('a', 'category', 'ocio', 600000)] });
    expect(result.warnings).toContainEqual({ code: 'sublimits_exceed_envelope', group: 'want', amountMinor: 100000 });
    expect(result.groups.want.allocatedMinor).toBe(500000);
  });

  it('flags overBudget only for non-zero limits', () => {
    const result = run({
      transactions: [spend('ocio', 600000), spend('mercado', 300000), spend('arriendo', 900000)],
      lines: [line('g', 'group', 'want', 500000), line('m', 'category', 'mercado', 0), line('r', 'category', 'arriendo', 800000), line('z', 'group', 'saving', 0)],
    });
    expect(result.groups.want.overBudget).toBe(true);
    expect(result.groups.saving.overBudget).toBe(false);
    expect(result.groups.need.overBudget).toBe(true);
    expect(row(result, 'need', 'mercado')).toMatchObject({ plannedMinor: 0, actualMinor: 300000, overBudget: false });
    expect(row(result, 'need', 'arriendo')).toMatchObject({ overBudget: true, remainingMinor: -100000 });
    expect(rows(result, 'need').map((c) => c.categoryId)).not.toContain('viejo');
  });
});

describe('Por asignar, budget used and totals', () => {
  it('does not double count and goes negative with a warning', () => {
    const lines = [line('g', 'group', 'want', 500000), line('a', 'category', 'ocio', 200000), line('b', 'category', 'ocio', 250000), line('n', 'group', 'need', 1500000)];
    expect(run({ transactions: [income(4000000)], lines }).totals.porAsignarMinor).toBe(2000000);
    const over = run({ transactions: [income(1000000)], lines: [line('n', 'group', 'need', 1200000)] });
    expect(over.totals.porAsignarMinor).toBe(-200000);
    expect(over.warnings).toContainEqual({ code: 'over_allocated' });
  });

  it('computes budgetUsed from consumption limits only', () => {
    const result = run({
      transactions: [spend('mercado', 800000), spend('arriendo', 700000), spend('ocio', 400000)],
      lines: [line('a', 'category', 'mercado', 1000000), line('b', 'category', 'arriendo', 1000000)],
    });
    expect(result.totals.budgetUsed).toEqual({ plannedMinor: 2000000, spentMinor: 1500000 });
    expect(result.totals.budgetUsedRatio).toBe(0.75);
    const envelope = run({ transactions: [spend('ocio', 600000)], lines: [line('g', 'group', 'want', 500000)] });
    expect(envelope.totals.budgetUsed).toEqual({ plannedMinor: 500000, spentMinor: 600000 });
    expect(run({ transactions: [spend('ocio', 600000)] }).totals.budgetUsedRatio).toBeNull();
  });

  it('computes consumption, outflow, balance and rates', () => {
    const result = run({ transactions: [income(4000000), spend('mercado', 1500000), spend('ahorro', 800000), spend('etf', 200000), spend('cuotas', 500000)] });
    expect(result.totals).toMatchObject({ consumptionMinor: 1500000, savingMinor: 800000, investmentMinor: 200000, debtMinor: 500000, outflowMinor: 3000000, balanceMinor: 1000000 });
    expect(result.rates).toEqual({ savingsRateBp: 2500, debtShareBp: 1250 });
    expect(run({}).rates).toEqual({ savingsRateBp: null, debtShareBp: null });
  });
});

describe('debt actuals and scope', () => {
  const debtActual = (input) => run(input).groups.debt.actualMinor;

  it('is void-aware and counts payments plus extra payments', () => {
    expect(debtActual({ debtEvents: [event('p1', 'payment', 500000), voidOf('v1', 'p1')] })).toBe(0);
    expect(debtActual({ debtEvents: [event('p1', 'payment', 300000), event('p2', 'extra_payment', 200000, { payloadJson: JSON.stringify({ strategy: 'reduce_term' }) })] })).toBe(500000);
  });

  it('ignores disbursements, charges, other months and out-of-scope debts', () => {
    const events = [event('p1', 'payment', 100000), event('e0', 'disbursement', 900000), event('c1', 'charge', 50000, { payloadJson: JSON.stringify({ trancheType: 'revolving', label: 'Compra' }) }), event('p2', 'payment', 70000, { effectiveOn: '2026-09-30' }), event('p3', 'payment', 40000, { debtId: 'd2' })];
    expect(debtActual({ debts: [debt('d1'), debt('d2', 'partner')], debtEvents: events, inScope: (item) => item.ownerScope !== 'partner' })).toBe(100000);
  });

  it('does not double count cost rows but adds debt-kind expenses without debtId', () => {
    const base = { debtEvents: [event('p1', 'payment', 500000)] };
    const withCost = run({ ...base, transactions: [spend('mercado', 40000, { debtId: 'd1' })] });
    expect(withCost.groups.debt.actualMinor).toBe(500000);
    expect(withCost.groups.need.actualMinor).toBe(0);
    expect(debtActual({ ...base, transactions: [spend('cuotas', 80000)] })).toBe(580000);
  });

  it('falls back to cost rows with a warning when debt data is unavailable', () => {
    const result = run({ debtEvents: null, transactions: [spend('mercado', 40000, { debtId: 'd1' }), spend('cuotas', 80000)] });
    expect(result.groups.debt.actualMinor).toBe(120000);
    expect(result.warnings).toContainEqual({ code: 'debt_data_unavailable' });
  });

  it('treats unreadable events as unavailable debt data', () => {
    const result = run({ debtEvents: [event('p1', 'payment', 0)], transactions: [spend('cuotas', 80000)] });
    expect(result.groups.debt.actualMinor).toBe(80000);
    expect(result.warnings).toContainEqual({ code: 'debt_data_unavailable' });
  });

  it('applies percent to the scoped income and keeps fixed lines as household amounts', () => {
    const inScope = (item) => item.ownerScope === 'you';
    const lines = [pct('p', 'group', 'saving', 2000), line('f', 'category', 'arriendo', 500000)];
    const result = run({ scoped: true, inScope, lines, transactions: [income(2000000), income(3000000, { ownerScope: 'partner' })] });
    expect(result.groups.saving.allocatedMinor).toBe(400000);
    expect(row(result, 'need', 'arriendo')).toMatchObject({ plannedMinor: 500000, householdFixed: true });
    expect(row(run({ lines }), 'need', 'arriendo').householdFixed).toBe(false);
  });

  it('counts both a card purchase and its card payment (documented limitation)', () => {
    const result = run({ transactions: [spend('ocio', 100000)], debtEvents: [event('p1', 'payment', 100000)] });
    expect(result.totals).toMatchObject({ consumptionMinor: 100000, debtMinor: 100000 });
  });
});
