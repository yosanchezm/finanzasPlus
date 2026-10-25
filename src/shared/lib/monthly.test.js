import { describe, expect, it } from 'vitest';
import { aggregateMonthlyTotals, computeDelta } from './monthly';

const at = (year, month, day) => new Date(year, month, day, 12).toISOString();

const categoriesById = new Map([
  ['c-need', { $id: 'c-need', kind: 'need' }],
  ['c-save', { $id: 'c-save', kind: 'saving' }],
  ['c-inv', { $id: 'c-inv', kind: 'investment' }],
]);
const tx = (type, amountMinor, occurredAt, extra = {}) => ({ type, amountMinor, occurredAt, ...extra });

describe('aggregateMonthlyTotals', () => {
  it('delegates to monthOutflows: groups per month, zero-filled, local-time months', () => {
    const totals = aggregateMonthlyTotals([
      tx('income', 1000, at(2026, 7, 3)),
      tx('expense', 300, at(2026, 7, 20), { categoryId: 'c-need' }),
      tx('expense', 200, at(2026, 9, 1), { categoryId: 'c-need' }),
      tx('income', 999, at(2026, 3, 1)),
    ], ['2026-08', '2026-09', '2026-10'], { categoriesById });

    expect(totals.map(({ month, income, consumption, outflow, expenses }) => ({ month, income, consumption, outflow, expenses }))).toEqual([
      { month: '2026-08', income: 1000, consumption: 300, outflow: 300, expenses: 300 },
      { month: '2026-09', income: 0, consumption: 0, outflow: 0, expenses: 0 },
      { month: '2026-10', income: 0, consumption: 200, outflow: 200, expenses: 200 },
    ]);
  });

  it('counts saving, investment and debt as outflow but not as consumption, and ignores transfers', () => {
    const [row] = aggregateMonthlyTotals([
      tx('income', 5000, at(2026, 9, 1)),
      tx('expense', 1000, at(2026, 9, 2), { categoryId: 'c-need' }),
      tx('expense', 700, at(2026, 9, 3), { categoryId: 'c-save' }),
      tx('expense', 300, at(2026, 9, 4), { categoryId: 'c-inv' }),
      tx('expense', 500, at(2026, 9, 5), { debtId: 'd1' }),
      tx('transfer', 9999, at(2026, 9, 6)),
    ], ['2026-10'], { categoriesById });

    expect(row).toMatchObject({ income: 5000, consumption: 1000, saving: 700, investment: 300, debt: 500, outflow: 2500, expenses: 2500 });
    expect(row.income - row.expenses).toBe(2500);
  });

  it('prefers debt payments over cost rows when debt events are readable', () => {
    const debts = [{ $id: 'd1', ownerScope: 'shared' }];
    const debtEvents = [{ $id: 'p1', debtId: 'd1', kind: 'payment', amountMinor: 400, effectiveOn: '2026-10-08', payloadJson: '{}' }];
    const [row] = aggregateMonthlyTotals([tx('expense', 500, at(2026, 9, 5), { debtId: 'd1' })], ['2026-10'], { categoriesById, debts, debtEvents });

    expect(row.debt).toBe(400);
  });

  it('returns zeros for every month when there are no transactions', () => {
    expect(aggregateMonthlyTotals([], ['2026-09', '2026-10']).map(({ income, expenses }) => [income, expenses])).toEqual([[0, 0], [0, 0]]);
  });
});

describe('computeDelta', () => {
  it('returns the difference and the percentage against the previous value', () => {
    expect(computeDelta(1200, 1000)).toEqual({ difference: 200, percent: 20 });
    expect(computeDelta(500, 1000)).toEqual({ difference: -500, percent: -50 });
  });

  it('uses the absolute previous value so negative balances keep the right direction', () => {
    expect(computeDelta(-50, -100)).toEqual({ difference: 50, percent: 50 });
  });

  it('has no percentage when the previous value is zero', () => {
    expect(computeDelta(300, 0)).toEqual({ difference: 300, percent: null });
    expect(computeDelta(0, 0)).toEqual({ difference: 0, percent: null });
  });
});
