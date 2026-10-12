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
});
