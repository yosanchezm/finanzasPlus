// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { daysBetween } from '../../src/calendar.js';
import { dailyRate } from '../../src/late/policy.js';
import { project } from '../../src/ledger/project.js';
import { resolveLegal } from '../../src/legal.js';
import { EA, debt, ev } from '../helpers/loans.js';
import { mulberry32 } from '../helpers/prng.js';

// Mora invariants (spec "Mora invariants") over 200 seeded loans. Caps: 28.59% EA until June, 27.50% from July.
const HIGH_CAP = 28.59;
const LEGAL = resolveLegal([], {
  usuryTable: [
    { modality: 'consumer', validFrom: '2026-01-01', validTo: '2026-06-30', capEA: HIGH_CAP, source: 'test', verified: true },
    { modality: 'consumer', validFrom: '2026-07-01', validTo: '2026-12-31', capEA: 27.5, source: 'test', verified: true },
  ],
});
const FEE = { id: 'fee', kind: 'fee', label: 'Admin fee', basis: 'fixed', value: 15_000 };
const FIXED_BEYOND_CAP = EA(60);

const random = mulberry32(20_260_714);
const between = (low, high) => low + Math.floor(random() * (high - low + 1));
const pick = (items) => items[between(0, items.length - 1)];
const dateIn = (from, to) => {
  const start = Date.UTC(2026, from[0] - 1, from[1]);
  const end = Date.UTC(2026, to[0] - 1, to[1]);
  const moved = new Date(start + Math.floor(random() * ((end - start) / 86_400_000 + 1)) * 86_400_000);
  return moved.toISOString().slice(0, 10);
};

function randomLoan() {
  const system = pick(['french', 'german', 'interest_only']);
  const late = pick([{ mode: 'usury' }, { mode: 'fixed', rate: FIXED_BEYOND_CAP }, { mode: 'fixed', rate: EA(between(8, 25)) }, { mode: 'contract_multiple', multiple: pick([0.5, 1, 1.5, 3]) }]);
  return {
    kind: 'consumer',
    principalMinor: between(500, 30_000) * 1000,
    openedOn: '2026-01-10',
    rate: EA(between(5, 35)),
    system,
    periodicity: 'monthly',
    n: between(3, 36),
    firstDueOn: `2026-02-${String(between(1, 28)).padStart(2, '0')}`,
    late: { graceDays: between(0, 5), ...late },
  };
}
const LOANS = Array.from({ length: 200 }, randomLoan);
const run = (terms, events, asOf) => project(debt(terms), events, asOf, { legal: LEGAL });

describe('mora properties over 200 seeded loans', () => {
  it('is never negative, never decreases as the date moves on, and so neither does the total', () => {
    let positive = 0;
    for (const terms of LOANS) {
      const earlier = run(terms, [], dateIn([2, 1], [6, 15]));
      const later = run(terms, [], dateIn([6, 16], [11, 30]));
      expect(later.lateInterestMinor).toBeGreaterThanOrEqual(earlier.lateInterestMinor);
      expect(earlier.lateInterestMinor).toBeGreaterThanOrEqual(0);
      later.plan.forEach((row, index) => {
        expect(row.lateMinor).toBeGreaterThanOrEqual(0);
        if (index < earlier.plan.length) expect(row.lateMinor).toBeGreaterThanOrEqual(earlier.plan[index].lateMinor);
      });
      if (later.lateInterestMinor > 0) positive += 1;
    }
    expect(positive).toBeGreaterThan(150);
  });

  it('never exceeds the highest cap on the unpaid principal for the days overdue', () => {
    for (const terms of LOANS) {
      const asOf = dateIn([3, 1], [11, 30]);
      const projection = run(terms, [], asOf);
      for (const row of projection.plan) {
        const overdueDays = Math.max(daysBetween(row.dueOn, asOf), 0);
        const bound = Math.max(row.principalMinor, 0) * dailyRate(HIGH_CAP) * overdueDays;
        expect(row.lateMinor).toBeLessThanOrEqual(Math.ceil(bound));
      }
    }
  });

  it('is zero for mode none, for a 0% contract multiple, and before anything is due', () => {
    for (const terms of LOANS.slice(0, 60)) {
      const asOf = dateIn([8, 1], [11, 30]);
      expect(run({ ...terms, late: { mode: 'none' } }, [], asOf).lateInterestMinor).toBe(0);
      const free = { ...terms, rate: { convention: 'ZERO' }, late: { mode: 'contract_multiple', multiple: 2 } };
      const projection = run(free, [], asOf);
      if (terms.system !== 'interest_only') expect(projection.pastDueMinor).toBeGreaterThan(0);
      expect(projection.lateInterestMinor).toBe(0);
      expect(run(terms, [], '2026-01-31').lateInterestMinor).toBe(0);
    }
  });

  it('does not depend on the interest, charges or taxes of the row', () => {
    for (const terms of LOANS.slice(0, 80)) {
      const asOf = dateIn([5, 1], [11, 30]);
      const plain = run(terms, [], asOf);
      const charged = run({ ...terms, charges: [FEE, { id: 'iva', kind: 'tax', label: 'IVA', basis: 'pctOfCharge', refId: 'fee', value: 19 }] }, [], asOf);
      expect(charged.plan.map((row) => row.lateMinor)).toEqual(plain.plan.map((row) => row.lateMinor));
      expect(charged.plan.some((row) => row.chargesMinor > 0)).toBe(true);
    }
  });

  it('interest-only rows before the last accrue nothing', () => {
    const interestOnly = LOANS.filter((terms) => terms.system === 'interest_only');
    expect(interestOnly.length).toBeGreaterThan(30);
    for (const terms of interestOnly) {
      const projection = run(terms, [], dateIn([8, 1], [11, 30]));
      projection.plan.slice(0, -1).forEach((row) => expect(row.lateMinor).toBe(0));
    }
  });

  it('is path independent: a no-op boundary on any date moves the rounded mora by at most 1 peso', () => {
    let identical = 0;
    for (const terms of LOANS) {
      const asOf = dateIn([8, 1], [11, 30]);
      const boundary = dateIn([2, 20], [7, 31]);
      const noop = ev('adjustment', boundary, 0, { balanceMinor: run(terms, [], boundary).balanceMinor }, 'noop');
      const whole = run(terms, [], asOf);
      const split = run(terms, [noop], asOf);
      expect(split.applied).toHaveLength(1);
      expect(Math.abs(split.lateInterestMinor - whole.lateInterestMinor)).toBeLessThanOrEqual(1);
      split.plan.forEach((row, index) => expect(Math.abs(row.lateMinor - whole.plan[index].lateMinor)).toBeLessThanOrEqual(1));
      if (split.lateInterestMinor === whole.lateInterestMinor) identical += 1;
    }
    expect(identical).toBeGreaterThanOrEqual(195);
  });

  it('keeps every amount non-negative when payments arrive in between', () => {
    for (const terms of LOANS.slice(0, 100)) {
      const events = Array.from({ length: between(1, 3) }, (_, index) => ev('payment', dateIn([2, 10], [9, 30]), between(50, 900) * 1000, {}, `p${index}`));
      const projection = run(terms, events, '2026-11-30');
      projection.plan.forEach((row) => {
        expect(row.outstandingMinor).toBeGreaterThanOrEqual(0);
        expect(row.lateMinor).toBeGreaterThanOrEqual(0);
      });
      projection.applied.forEach((entry) => expect(entry.allocation.lateInterest).toBeGreaterThanOrEqual(0));
      expect(projection.lateInterestMinor).toBeGreaterThanOrEqual(0);
      expect(projection.totals.remainingLateInterest).toBe(projection.lateInterestMinor);
    }
  });
});
