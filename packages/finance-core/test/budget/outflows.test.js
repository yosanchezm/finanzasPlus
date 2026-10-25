// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { computeBudgetMonth } from '../../src/budget/compute.js';
import { monthOutflows } from '../../src/budget/outflows.js';

const cat = (id, kind) => ({ $id: id, name: id, color: '#111', kind, archived: false });
const categories = [cat('salario', 'income'), cat('mercado', 'need'), cat('ocio', 'want'), cat('ahorro', 'saving'), cat('etf', 'investment'), cat('cuotas', 'debt')];
const categoriesById = new Map(categories.map((category) => [category.$id, category]));
const tx = (type, amountMinor, categoryId, occurredAt, extra) => ({ type, amountMinor, categoryId, occurredAt, ownerScope: 'you', ...extra });
const debts = [{ $id: 'd1', ownerScope: 'you' }, { $id: 'd2', ownerScope: 'partner' }];
const payment = (id, amountMinor, effectiveOn, extra) => ({ $id: id, debtId: 'd1', kind: 'payment', effectiveOn, amountMinor, payloadJson: '{}', ...extra });
const MONTHS = ['2026-09', '2026-10'];

const transactions = [
  tx('income', 4000000, 'salario', '2026-10-01T12:00:00.000Z'),
  tx('expense', 1500000, 'mercado', '2026-10-03T12:00:00.000Z'),
  tx('expense', 800000, 'ocio', '2026-10-04T12:00:00.000Z'),
  tx('expense', 200000, 'ahorro', '2026-10-05T12:00:00.000Z'),
  tx('expense', 500000, 'etf', '2026-10-06T12:00:00.000Z'),
  tx('transfer', 900000, 'mercado', '2026-10-07T12:00:00.000Z'),
  tx('income', 3000000, 'salario', '2026-09-01T12:00:00.000Z'),
  tx('expense', 100000, 'mercado', '2026-09-02T12:00:00.000Z'),
];

describe('monthOutflows', () => {
  it('returns one row per requested month, in order, with zeros for empty months', () => {
    const result = monthOutflows(transactions, [], debts, ['2026-08', ...MONTHS], categoriesById);
    expect(result.map((row) => row.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(result[0]).toMatchObject({ income: 0, consumption: 0, saving: 0, investment: 0, debt: 0, outflow: 0 });
  });

  it('splits every group and ignores transfers', () => {
    const [sep, oct] = monthOutflows(transactions, [payment('p1', 300000, '2026-10-08')], debts, MONTHS, categoriesById);
    expect(oct).toMatchObject({ income: 4000000, consumption: 2300000, saving: 200000, investment: 500000, debt: 300000, outflow: 3300000 });
    expect(sep).toMatchObject({ income: 3000000, consumption: 100000, saving: 0, investment: 0, debt: 0, outflow: 100000 });
  });

  it('income minus outflow equals the computeBudgetMonth balance for the same data', () => {
    const events = [payment('p1', 300000, '2026-10-08'), payment('p2', 50000, '2026-10-09', { kind: 'extra_payment', payloadJson: JSON.stringify({ strategy: 'reduce_term' }) })];
    const [, oct] = monthOutflows(transactions, events, debts, MONTHS, categoriesById);
    const month = computeBudgetMonth({
      month: '2026-10', categories, debts, debtEvents: events,
      transactions: transactions.filter((item) => item.occurredAt.startsWith('2026-10')),
    });
    expect(oct.income - oct.outflow).toBe(month.totals.balanceMinor);
    expect(oct.outflow).toBe(month.totals.outflowMinor);
    expect(oct.debt).toBe(350000);
  });

  it('uses payment events, ignores voided ones and out-of-scope debts', () => {
    const events = [
      payment('p1', 300000, '2026-10-08'),
      payment('p2', 999, '2026-10-09'),
      { $id: 'v1', debtId: 'd1', kind: 'void', effectiveOn: '2026-10-09', amountMinor: 0, payloadJson: JSON.stringify({ targetEventId: 'p2', reason: 'x' }) },
      payment('p3', 777, '2026-10-10', { debtId: 'd2' }),
      { $id: 'c1', debtId: 'd1', kind: 'charge', effectiveOn: '2026-10-11', amountMinor: 555, payloadJson: JSON.stringify({ trancheType: 'revolving', label: 'Compra' }) },
    ];
    const rows = monthOutflows(transactions, events, debts, MONTHS, categoriesById, { inScope: (item) => item.ownerScope === 'you' });
    expect(rows[1].debt).toBe(300000);
  });

  it('payments replace cost rows that carry a debtId; kind-only debt rows still count', () => {
    const rows = [
      tx('expense', 400000, 'cuotas', '2026-10-02T12:00:00.000Z', { debtId: 'd1' }),
      tx('expense', 80000, 'cuotas', '2026-10-03T12:00:00.000Z'),
    ];
    const [, oct] = monthOutflows(rows, [payment('p1', 500000, '2026-10-08')], debts, MONTHS, categoriesById);
    expect(oct.debt).toBe(580000);
  });

  it('falls back to the cost rows when debtEvents is null', () => {
    const rows = [
      tx('expense', 120000, 'cuotas', '2026-10-02T12:00:00.000Z', { debtId: 'd1' }),
      tx('expense', 80000, 'cuotas', '2026-10-03T12:00:00.000Z'),
    ];
    const [, oct] = monthOutflows(rows, null, debts, MONTHS, categoriesById);
    expect(oct.debt).toBe(200000);
    expect(oct.outflow).toBe(200000);
  });
});
