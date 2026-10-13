// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../appwrite';
import { averageCashflow, loadCashflow } from './cashflow';

vi.mock('../../appwrite', () => ({ getTransactionsInRange: vi.fn() }));

const row = (type, amountMinor, occurredAt, ownerScope = 'you') => ({ type, amountMinor, occurredAt, ownerScope });
const TODAY = '2026-10-13';

describe('averageCashflow', () => {
  it('averages the three full months before the current one', () => {
    const rows = [
      row('income', 3000000, '2026-07-15T12:00:00'), row('income', 3000000, '2026-08-15T12:00:00'), row('income', 3600000, '2026-09-15T12:00:00'),
      row('expense', 1000000, '2026-07-20T12:00:00'), row('expense', 2000000, '2026-09-02T12:00:00'),
      row('income', 9000000, '2026-10-01T12:00:00'), row('expense', 9000000, '2026-06-30T12:00:00'), // current and older months do not count
    ];

    expect(averageCashflow(rows, TODAY)).toEqual({ avgIncomeMinor: 3200000, avgExpenseMinor: 1000000 });
  });

  it('is unknown without recorded income, and honors the scope filter', () => {
    expect(averageCashflow([], TODAY)).toBeNull();
    expect(averageCashflow([row('expense', 500000, '2026-09-02T12:00:00')], TODAY)).toBeNull();

    const rows = [row('income', 3000000, '2026-09-02T12:00:00'), row('income', 6000000, '2026-09-03T12:00:00', 'partner'), row('expense', 300000, '2026-09-04T12:00:00')];
    expect(averageCashflow(rows, TODAY, (item) => item.ownerScope === 'you')).toEqual({ avgIncomeMinor: 1000000, avgExpenseMinor: 100000 });
  });
});

describe('loadCashflow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the three months from the data layer, and is unknown (never throws) when that fails', async () => {
    api.getTransactionsInRange.mockResolvedValueOnce([row('income', 3000000, '2026-09-02T12:00:00')]);
    expect(await loadCashflow({ today: TODAY })).toEqual({ avgIncomeMinor: 1000000, avgExpenseMinor: 0 });
    const [start, end] = api.getTransactionsInRange.mock.calls[0];
    expect(new Date(start).getMonth()).toBe(6); // July
    expect(new Date(end).getMonth()).toBe(9); // October

    api.getTransactionsInRange.mockRejectedValueOnce(new Error('sin red'));
    expect(await loadCashflow({ today: TODAY })).toBeNull();
  });
});
