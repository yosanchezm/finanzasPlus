// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { decorate, lateMinor, newRow, paidTotal, rowDue, rowOutstanding } from '../../src/ledger/rows.js';
import { buildSchedule } from '../../src/schedule/index.js';
import { french } from '../helpers/loans.js';

const FEE = { id: 'fee', kind: 'fee', label: 'Admin fee', basis: 'fixed', value: 10_000 };
const rowsOf = (overrides = {}) => buildSchedule(french({ charges: [FEE], ...overrides })).map(newRow);

describe('rows: accrued mora', () => {
  it('a new row owes no mora, so its due and outstanding amounts are the schedule figures', () => {
    const [row] = rowsOf();
    expect(lateMinor(row)).toBe(0);
    expect(rowDue(row)).toEqual({ charges: 10_000, taxes: 0, lateInterest: 0, interest: 180_876, principal: 199_505 });
    expect(rowOutstanding(row)).toBe(390_381);
  });

  it('accrued mora is rounded once and shows as lateInterest due and in the outstanding amount', () => {
    const [row] = rowsOf();
    row.late.exact = 1374.92;
    expect(lateMinor(row)).toBe(1375);
    expect(rowDue(row).lateInterest).toBe(1375);
    expect(rowOutstanding(row)).toBe(390_381 + 1375);
  });

  it('paid mora reduces what is due and what is outstanding, bucket by bucket', () => {
    const [row] = rowsOf();
    row.late.exact = 1374.92;
    row.paid.lateInterest = 1000;
    row.paid.charges = 10_000;
    expect(rowDue(row)).toMatchObject({ lateInterest: 375, charges: 0, interest: 180_876 });
    expect(paidTotal(row)).toBe(11_000);
    expect(rowOutstanding(row)).toBe(390_381 + 1375 - 11_000);
  });

  it('rounds to the unit stored with the accumulator', () => {
    const [row] = rowsOf();
    row.late.exact = 1374.92;
    row.late.unit = 100;
    expect(lateMinor(row)).toBe(1400);
  });

  it('a settled (refinanced) row owes nothing, whatever it accrued', () => {
    const [row] = rowsOf();
    row.late.exact = 1374.92;
    row.settled = true;
    expect(rowDue(row)).toEqual({ charges: 0, taxes: 0, lateInterest: 0, interest: 0, principal: 0 });
    expect(rowOutstanding(row)).toBe(0);
  });

  it('decorate keeps the private accumulator out of the plan rows', () => {
    const rows = rowsOf();
    rows[0].late.exact = 1374.92;
    const [first] = decorate(rows, '2026-02-25');
    expect(first).not.toHaveProperty('late');
    expect(first).toMatchObject({ status: 'pastDue', outstandingMinor: 390_381 + 1375 });
  });
});
