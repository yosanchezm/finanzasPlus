// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { accrueLate } from '../../src/late/accrue.js';
import { dailyRate } from '../../src/late/policy.js';
import { newRow, lateMinor, rowDue } from '../../src/ledger/rows.js';
import { resolveLegal } from '../../src/legal.js';
import { buildSchedule } from '../../src/schedule/index.js';
import { validateTerms } from '../../src/terms.js';
import { EA, french } from '../helpers/loans.js';

// Golden loan: French 10,000,000 at 24% EA over 36 months. Row 1 is due 2026-02-15 with
// principal 199,505, interest 180,876 and (with the fee) charges 10,000. The usury cap is 28.59% EA.
const FEE = { id: 'fee', kind: 'fee', label: 'Admin fee', basis: 'fixed', value: 10_000 };
const cap = (capEA, validFrom, validTo, modality = 'consumer') => ({ modality, validFrom, validTo, capEA, source: 'test', verified: true });
const legalOf = (...entries) => resolveLegal([], { usuryTable: entries });
const YEAR_AT_2859 = legalOf(cap(28.59, '2026-01-01', '2026-12-31'));
const DAILY_2859 = dailyRate(28.59);

const USURY = { mode: 'usury' };

const stateOf = (late, overrides = {}) => {
  const work = validateTerms(french({ late, ...overrides }));
  return { work, rows: buildSchedule(work).map(newRow), lateClock: work.openedOn, lateNotices: [] };
};
const exactOf = (state, index = 0) => state.rows[index].late.exact;

describe('accrueLate: golden numbers (28.59% EA on 199,505)', () => {
  it('10 days overdue accrue 1,375 (exact 1,374.92)', () => {
    const state = stateOf(USURY);
    accrueLate(state, '2026-02-25', YEAR_AT_2859);
    expect(DAILY_2859).toBeCloseTo(0.0006891657555, 12);
    expect(exactOf(state)).toBeCloseTo(1374.92, 2);
    expect(lateMinor(state.rows[0])).toBe(1375);
    expect(state.rows[0].late.days).toBe(10);
    expect(state.lateClock).toBe('2026-02-25');
  });

  it('30 days overdue accrue 4,125 (exact 4,124.76), triangulating the day count', () => {
    const state = stateOf(USURY);
    accrueLate(state, '2026-03-17', YEAR_AT_2859);
    expect(exactOf(state)).toBeCloseTo(4124.76, 2);
    expect(lateMinor(state.rows[0])).toBe(4125);
    expect(state.rows[0].late.days).toBe(30);
  });

  it('grace of 3 days accrues for 7 days', () => {
    const state = stateOf({ mode: 'usury', graceDays: 3 });
    accrueLate(state, '2026-02-25', YEAR_AT_2859);
    expect(state.rows[0].late.days).toBe(7);
    expect(exactOf(state)).toBeCloseTo(199_505 * DAILY_2859 * 7, 6);
    expect(lateMinor(state.rows[0])).toBe(962);
  });

  it('a cap change mid-way (28.59% for 5 days, 27.50% for 5) rounds once to 1,352', () => {
    const state = stateOf(USURY);
    const legal = legalOf(cap(28.59, '2026-02-01', '2026-02-20'), cap(27.5, '2026-02-21', '2026-02-28'));
    accrueLate(state, '2026-02-25', legal);
    expect(199_505 * DAILY_2859 * 5).toBeCloseTo(687.46, 2);
    expect(199_505 * dailyRate(27.5) * 5).toBeCloseTo(664.18, 2);
    expect(exactOf(state)).toBeCloseTo(1351.64, 2);
    expect(lateMinor(state.rows[0])).toBe(1352);
    expect(state.rows[0].late.days).toBe(10);
  });
});

describe('accrueLate: day clock', () => {
  it('the due date itself and the day of a payment on it accrue nothing; the next day accrues one day', () => {
    const state = stateOf(USURY);
    accrueLate(state, '2026-02-15', YEAR_AT_2859);
    expect(exactOf(state)).toBe(0);
    expect(state.rows[0].late.days).toBe(0);
    accrueLate(state, '2026-02-16', YEAR_AT_2859);
    expect(exactOf(state)).toBeCloseTo(199_505 * DAILY_2859, 8);
    expect(state.rows[0].late.days).toBe(1);
  });

  it('grace days push the first accruing day to dueOn + grace + 1', () => {
    const state = stateOf({ mode: 'usury', graceDays: 3 });
    accrueLate(state, '2026-02-18', YEAR_AT_2859);
    expect(state.rows[0].late.days).toBe(0);
    accrueLate(state, '2026-02-19', YEAR_AT_2859);
    expect(state.rows[0].late.days).toBe(1);
  });

  it('a row not yet due accrues nothing while the clock moves, and the clock never moves back', () => {
    const state = stateOf(USURY);
    accrueLate(state, '2026-03-14', YEAR_AT_2859);
    expect(state.rows[1].late.days).toBe(0);
    expect(exactOf(state, 1)).toBe(0);
    accrueLate(state, '2026-03-20', YEAR_AT_2859);
    expect(state.rows[1].late.days).toBe(5);
    accrueLate(state, '2026-01-01', YEAR_AT_2859);
    expect(state.lateClock).toBe('2026-03-20');
    expect(state.rows[1].late.days).toBe(5);
  });
});

describe('accrueLate: policy and cap', () => {
  it('a gap between two caps carries the earlier cap (stale) until the next one starts', () => {
    const state = stateOf(USURY);
    accrueLate(state, '2026-02-25', legalOf(cap(28.59, '2026-02-01', '2026-02-18'), cap(27.5, '2026-02-21', '2026-02-28')));
    expect(exactOf(state)).toBeCloseTo(199_505 * (DAILY_2859 * 5 + dailyRate(27.5) * 5), 6);
    expect(state.lateNotices).toHaveLength(1);
    expect(state.lateNotices[0]).toMatchObject({ code: 'late_cap_stale', lastValidTo: '2026-02-18' });
  });

  it('fixed 40% above the cap accrues exactly like usury, and a fixed 20% below it accrues less', () => {
    const usury = stateOf(USURY);
    const above = stateOf({ mode: 'fixed', rate: EA(40) });
    const below = stateOf({ mode: 'fixed', rate: EA(20) });
    for (const state of [usury, above, below]) accrueLate(state, '2026-02-25', YEAR_AT_2859);
    expect(exactOf(above)).toBe(exactOf(usury));
    expect(lateMinor(above.rows[0])).toBe(1375);
    expect(exactOf(below)).toBeCloseTo(199_505 * dailyRate(20) * 10, 6);
    expect(lateMinor(below.rows[0])).toBeLessThan(1375);
  });

  it('none and an absent policy accrue 0, and so does a 0% contract multiple', () => {
    const none = stateOf({ mode: 'none' });
    const absent = stateOf(undefined);
    const zeroContract = stateOf({ mode: 'contract_multiple', multiple: 2 }, { kind: 'family', rate: { convention: 'ZERO' } });
    for (const state of [none, absent, zeroContract]) accrueLate(state, '2026-05-15', YEAR_AT_2859);
    for (const state of [none, absent, zeroContract]) {
      expect(exactOf(state)).toBe(0);
      expect(state.rows[0].late.days).toBe(0);
      expect(lateMinor(state.rows[0])).toBe(0);
    }
  });

  it('contract_multiple is capped: 2 x 24% = 48% is cut to 28.59%, while 1 x 24% stays at 24%', () => {
    const doubled = stateOf({ mode: 'contract_multiple', multiple: 2 });
    const single = stateOf({ mode: 'contract_multiple', multiple: 1 });
    accrueLate(doubled, '2026-02-25', YEAR_AT_2859);
    accrueLate(single, '2026-02-25', YEAR_AT_2859);
    expect(lateMinor(doubled.rows[0])).toBe(1375);
    expect(exactOf(single)).toBeCloseTo(199_505 * dailyRate(24) * 10, 6);
  });

  it('with no cap known it uses the contract EA and raises late_cap_unknown once', () => {
    const state = stateOf(USURY);
    accrueLate(state, '2026-02-25', legalOf());
    accrueLate(state, '2026-03-05', legalOf());
    expect(state.rows[0].late.exact).toBeGreaterThan(199_505 * dailyRate(24) * 10);
    expect(exactOf(state)).toBeCloseTo(199_505 * dailyRate(24) * 18, 6);
    expect(state.lateNotices.map((notice) => notice.code)).toEqual(['late_cap_unknown']);
  });

  it('a carried cap is used and raises late_cap_stale with the last valid day, once', () => {
    const state = stateOf(USURY);
    const january = legalOf(cap(28.59, '2026-01-01', '2026-01-31'));
    accrueLate(state, '2026-02-20', january);
    accrueLate(state, '2026-02-25', january);
    expect(lateMinor(state.rows[0])).toBe(1375);
    expect(state.lateNotices).toHaveLength(1);
    expect(state.lateNotices[0]).toMatchObject({ code: 'late_cap_stale', modality: 'consumer', lastValidTo: '2026-01-31' });
  });

  it('raises no cap notice when nothing is overdue, even though the cap does not cover those days', () => {
    const state = stateOf(USURY);
    accrueLate(state, '2026-02-10', legalOf());
    expect(state.lateNotices).toEqual([]);
  });

  it('a mortgage reads the mortgage cap, not the consumer one', () => {
    const state = stateOf(USURY, { kind: 'mortgage' });
    accrueLate(state, '2026-02-25', legalOf(cap(28.59, '2026-01-01', '2026-12-31'), cap(14.5, '2026-01-01', '2026-12-31', 'mortgage')));
    expect(exactOf(state)).toBeCloseTo(199_505 * dailyRate(14.5) * 10, 6);
  });
});

describe('accrueLate: base', () => {
  it('charges, taxes and interest of the row never enter the base', () => {
    const plain = stateOf(USURY);
    const charged = stateOf(USURY, { charges: [FEE, { id: 'iva', kind: 'tax', label: 'IVA', basis: 'pctOfCharge', refId: 'fee', value: 19 }] });
    accrueLate(plain, '2026-02-25', YEAR_AT_2859);
    accrueLate(charged, '2026-02-25', YEAR_AT_2859);
    expect(charged.rows[0].chargesMinor).toBe(10_000);
    expect(exactOf(charged)).toBe(exactOf(plain));
  });

  it('paid principal lowers the base from then on (91,756 left accrues 632 over 10 days)', () => {
    const state = stateOf(USURY);
    state.rows[0].paid.principal = 107_749;
    accrueLate(state, '2026-02-25', YEAR_AT_2859);
    expect(exactOf(state)).toBeCloseTo(91_756 * DAILY_2859 * 10, 6);
    expect(lateMinor(state.rows[0])).toBe(632);
  });

  it('a fully settled row and a refinanced row accrue nothing', () => {
    const state = stateOf(USURY);
    state.rows[0].paid.principal = 199_505;
    state.rows[1].settled = true;
    accrueLate(state, '2026-04-20', YEAR_AT_2859);
    expect(exactOf(state, 0)).toBe(0);
    expect(exactOf(state, 1)).toBe(0);
    expect(state.rows[2].late.days).toBeGreaterThan(0);
  });

  it('capitalizing grace rows (negative principal) and interest-only rows accrue nothing', () => {
    const grace = stateOf(USURY, { principalMinor: 1_000_000, n: 6, grace: { periods: 2, type: 'total' } });
    expect(grace.rows[0].principalMinor).toBeLessThan(0);
    accrueLate(grace, '2026-09-01', YEAR_AT_2859);
    expect(exactOf(grace, 0)).toBe(0);
    expect(exactOf(grace, 1)).toBe(0);
    expect(exactOf(grace, 2)).toBeGreaterThan(0);
    const interestOnly = stateOf(USURY, { system: 'interest_only', n: 6 });
    accrueLate(interestOnly, '2026-08-01', YEAR_AT_2859);
    expect(interestOnly.rows.slice(0, 5).every((row) => row.late.exact === 0)).toBe(true);
    expect(exactOf(interestOnly, 5)).toBeGreaterThan(0);
  });
});

describe('accrueLate: segmentation and rounding', () => {
  it('splitting the window at any date does not change the exact accumulation beyond float noise', () => {
    const whole = stateOf(USURY);
    const split = stateOf(USURY);
    accrueLate(whole, '2026-03-17', YEAR_AT_2859);
    for (const date of ['2026-02-20', '2026-02-27', '2026-03-17']) accrueLate(split, date, YEAR_AT_2859);
    expect(exactOf(split)).toBeCloseTo(exactOf(whole), 9);
    expect(lateMinor(split.rows[0])).toBe(lateMinor(whole.rows[0]));
  });

  it('a boundary inserted on day 12 of a 30-day window changes the rounded total by at most 1', () => {
    const whole = stateOf(USURY);
    const split = stateOf(USURY);
    accrueLate(whole, '2026-03-17', YEAR_AT_2859);
    accrueLate(split, '2026-02-27', YEAR_AT_2859);
    accrueLate(split, '2026-03-17', YEAR_AT_2859);
    expect(Math.abs(lateMinor(split.rows[0]) - lateMinor(whole.rows[0]))).toBeLessThanOrEqual(1);
  });

  it('rounds to the rounding unit of the terms', () => {
    const state = stateOf(USURY, { roundingUnit: 100 });
    accrueLate(state, '2026-02-25', YEAR_AT_2859);
    expect(lateMinor(state.rows[0])).toBe(1400);
  });

  it('rowDue exposes the accrued mora minus what was paid of it', () => {
    const state = stateOf(USURY);
    accrueLate(state, '2026-02-25', YEAR_AT_2859);
    expect(rowDue(state.rows[0]).lateInterest).toBe(1375);
    state.rows[0].paid.lateInterest = 1000;
    expect(rowDue(state.rows[0]).lateInterest).toBe(375);
  });
});
