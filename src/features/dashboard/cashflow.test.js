import { describe, expect, it } from 'vitest';
import { buildCashflowSeries } from './cashflow';

const at = (day) => new Date(2026, 9, day, 12).toISOString();

describe('buildCashflowSeries', () => {
  it('accumulates income and expenses per day up to today', () => {
    const series = buildCashflowSeries([
      { type: 'income', amountMinor: 1000, occurredAt: at(1) },
      { type: 'expense', amountMinor: 200, occurredAt: at(2) },
      { type: 'expense', amountMinor: 300, occurredAt: at(2) },
      { type: 'income', amountMinor: 500, occurredAt: at(4) },
    ], new Date(2026, 9, 4));

    expect(series).toEqual([
      { day: 1, income: 1000, expenses: 0 },
      { day: 2, income: 1000, expenses: 500 },
      { day: 3, income: 1000, expenses: 500 },
      { day: 4, income: 1500, expenses: 500 },
    ]);
  });

  it('ignores transactions from other months or after today', () => {
    const series = buildCashflowSeries([
      { type: 'income', amountMinor: 1000, occurredAt: new Date(2026, 8, 30, 12).toISOString() },
      { type: 'expense', amountMinor: 50, occurredAt: at(20) },
    ], new Date(2026, 9, 2));

    expect(series).toEqual([
      { day: 1, income: 0, expenses: 0 },
      { day: 2, income: 0, expenses: 0 },
    ]);
  });

  it('plots income against outflow (saving, investment, debt) so the last net equals Balance, and ignores transfers', () => {
    const categoriesById = new Map([['s', { $id: 's', kind: 'saving' }], ['n', { $id: 'n', kind: 'need' }]]);
    const series = buildCashflowSeries([
      { type: 'income', amountMinor: 4000000, occurredAt: at(1) },
      { type: 'expense', amountMinor: 1500000, categoryId: 'n', occurredAt: at(2) },
      { type: 'expense', amountMinor: 800000, categoryId: 's', occurredAt: at(2) },
      { type: 'expense', amountMinor: 700000, debtId: 'd1', occurredAt: at(3) },
      { type: 'transfer', amountMinor: 999999, occurredAt: at(3) },
    ], new Date(2026, 9, 3), { categoriesById });

    const last = series[series.length - 1];
    expect(last).toEqual({ day: 3, income: 4000000, expenses: 3000000 });
    expect(last.income - last.expenses).toBe(1000000);
  });
});

describe('buildCashflowSeries debt payments', () => {
  const debts = [{ $id: 'd1', ownerScope: 'shared' }, { $id: 'd2', ownerScope: 'partner' }];
  const payment = (id, debtId, amountMinor, effectiveOn, kind = 'payment') => ({ $id: id, debtId, kind, effectiveOn, amountMinor, payloadJson: '{}' });
  const run = (transactions, debtEvents, extra = {}) => buildCashflowSeries(transactions, new Date(2026, 9, 5), { debts, debtEvents, ...extra });

  it('plots active payments on their effective day and drops cost rows that carry a debtId', () => {
    const series = run([
      { type: 'income', amountMinor: 4000000, occurredAt: at(1) },
      { type: 'expense', amountMinor: 500000, debtId: 'd1', occurredAt: at(2) },
      { type: 'expense', amountMinor: 80000, occurredAt: at(2), categoryId: 'cuotas' },
    ], [payment('p1', 'd1', 500000, '2026-10-03'), payment('p2', 'd1', 100000, '2026-09-30'), payment('o1', 'd1', 900000, '2026-10-03', 'disbursement')],
    { categoriesById: new Map([['cuotas', { $id: 'cuotas', kind: 'debt' }]]) });

    expect(series.map((point) => point.expenses)).toEqual([0, 80000, 580000, 580000, 580000]);
  });

  it('ignores voided payments and out-of-scope debts', () => {
    const events = [payment('p1', 'd1', 500000, '2026-10-02'), payment('p3', 'd2', 40000, '2026-10-02'), { $id: 'v1', debtId: 'd1', kind: 'void', effectiveOn: '2026-10-02', amountMinor: 0, payloadJson: JSON.stringify({ targetEventId: 'p1' }) }];
    const series = run([], events, { inScope: (item) => item.ownerScope !== 'partner' });
    expect(series[4].expenses).toBe(0);
  });

  it('keeps the cost rows when debt events are unavailable', () => {
    const series = run([{ type: 'expense', amountMinor: 500000, debtId: 'd1', occurredAt: at(2) }], null);
    expect(series[4].expenses).toBe(500000);
  });
});
