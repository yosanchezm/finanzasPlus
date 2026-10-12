import { describe, expect, it } from 'vitest';
import { aggregateMonthlyTotals, computeDelta } from './monthly';

const at = (year, month, day) => new Date(year, month, day, 12).toISOString();

describe('aggregateMonthlyTotals', () => {
  it('sums income and expenses per month and fills months without data with zero', () => {
    const totals = aggregateMonthlyTotals([
      { type: 'income', amountMinor: 1000, occurredAt: at(2026, 7, 3) },
      { type: 'expense', amountMinor: 300, occurredAt: at(2026, 7, 20) },
      { type: 'expense', amountMinor: 200, occurredAt: at(2026, 9, 1) },
      { type: 'income', amountMinor: 999, occurredAt: at(2026, 3, 1) },
    ], ['2026-08', '2026-09', '2026-10']);

    expect(totals).toEqual([
      { month: '2026-08', income: 1000, expenses: 300 },
      { month: '2026-09', income: 0, expenses: 0 },
      { month: '2026-10', income: 0, expenses: 200 },
    ]);
  });

  it('returns zeros for every month when there are no transactions', () => {
    expect(aggregateMonthlyTotals([], ['2026-09', '2026-10'])).toEqual([
      { month: '2026-09', income: 0, expenses: 0 },
      { month: '2026-10', income: 0, expenses: 0 },
    ]);
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
