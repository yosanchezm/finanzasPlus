// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dailyRate } from '../../src/late/policy.js';
import { project } from '../../src/ledger/project.js';
import { resolveLegal } from '../../src/legal.js';
import { buildSchedule } from '../../src/schedule/index.js';
import { EA, debt, ev, french, interestFree } from '../helpers/loans.js';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/late-28.59-golden.json', import.meta.url), 'utf8'));
const legalOf = (...entries) => resolveLegal([], { usuryTable: entries });
const GOLDEN_LEGAL = legalOf(...fixture.usuryTable);
const cap = (capEA, validFrom, validTo, modality = 'consumer') => ({ modality, validFrom, validTo, capEA, source: 'test', verified: true });
const withLate = (late, overrides = {}) => french({ charges: fixture.terms.charges, late, ...overrides });
const pay = (on, amountMinor, id, payload = {}) => ev('payment', on, amountMinor, payload, id);
const run = (terms, events, asOf, legal = GOLDEN_LEGAL) => project(debt(terms), events, asOf, { legal });

describe('project: mora goldens (28.59% EA, installment 390,381)', () => {
  it('uses the installment of the spec (charges 10,000, interest 180,876, principal 199,505)', () => {
    const [first] = buildSchedule(fixture.terms);
    expect(first).toMatchObject({ dueOn: fixture.installment.dueOn, chargesMinor: 10_000, interestMinor: 180_876, principalMinor: 199_505, totalDueMinor: 390_381 });
    expect(dailyRate(28.59)).toBeCloseTo(fixture.dailyRate, 12);
  });

  for (const scenario of fixture.cases) {
    it(scenario.name, () => {
      const events = scenario.events.map((entry, index) => pay(entry.on, entry.amountMinor, `p${index + 1}`));
      const projection = run(fixture.terms, events, scenario.asOf);
      const { row1, allocation, costMinor, ...totals } = scenario.expect;
      expect(projection.plan[0]).toMatchObject(row1);
      if (allocation) expect(projection.applied[0]).toMatchObject({ allocation, costMinor });
      expect(projection).toMatchObject(totals);
      expect(projection.totals.remainingLateInterest).toBe(projection.lateInterestMinor);
    });
  }

  it('the mora never compounds: the row total without mora stays 390,381 while the mora grows from 10 to 30 days', () => {
    const tenDays = run(fixture.terms, [], '2026-02-25');
    const thirtyDays = run(fixture.terms, [], '2026-03-17');
    expect(tenDays.plan[0].outstandingMinor - tenDays.plan[0].lateMinor).toBe(390_381);
    expect(thirtyDays.plan[0].outstandingMinor - thirtyDays.plan[0].lateMinor).toBe(390_381);
    expect(thirtyDays.plan[0].lateMinor).toBeGreaterThan(tenDays.plan[0].lateMinor);
    expect(thirtyDays.totals.remainingInterest).toBe(tenDays.totals.remainingInterest);
  });

  it('a row with mora that is paid in full carries the mora in its paid total and settles', () => {
    const projection = run(fixture.terms, [pay('2026-02-25', 391_756, 'p1')], '2026-02-25');
    expect(projection.plan[0]).toMatchObject({ status: 'paid', outstandingMinor: 0, paidMinor: 391_756, lateMinor: 1375, lateBaseMinor: 0 });
    expect(projection.pastDueMinor).toBe(0);
    expect(projection.lateInterestMinor).toBe(0);
  });
});

describe('project: mora fields and policy', () => {
  it('mode none and an absent policy project zero mora even when far overdue', () => {
    for (const late of [{ mode: 'none' }, undefined]) {
      const projection = run(withLate(late), [], '2026-09-30');
      expect(projection.pastDueMinor).toBeGreaterThan(2_000_000);
      expect(projection.lateInterestMinor).toBe(0);
      expect(projection.totals.remainingLateInterest).toBe(0);
      expect(projection.plan.every((row) => row.lateMinor === 0 && row.lateDays === 0 && row.lateBaseMinor === 0)).toBe(true);
    }
  });

  it('under none, mora stated by the bank still counts as paid late interest and cost', () => {
    const split = { charges: 10_000, lateInterest: 5_000, interest: 180_876, principal: 199_505 };
    const projection = run(withLate({ mode: 'none' }), [pay('2026-02-25', 395_381, 'p1', { bankSplit: split })], '2026-02-25');
    expect(projection.applied[0]).toMatchObject({ allocation: { lateInterest: 5_000, interest: 180_876, principal: 199_505, surplus: 0 }, costMinor: 195_876 });
    expect(projection.lateInterestMinor).toBe(0);
    expect(projection.plan[0].status).toBe('paid');
  });

  it('a fixed rate below the cap accrues less than usury and the mora adds to the past due amount', () => {
    const usury = run(withLate({ mode: 'usury' }), [], '2026-02-25');
    const fixed = run(withLate({ mode: 'fixed', rate: EA(20) }), [], '2026-02-25');
    expect(fixed.lateInterestMinor).toBe(Math.round(199_505 * dailyRate(20) * 10));
    expect(fixed.lateInterestMinor).toBeLessThan(usury.lateInterestMinor);
    expect(fixed.pastDueMinor).toBe(390_381 + fixed.lateInterestMinor);
  });

  it('interest-only overdue rows give 0 mora until the principal falls due', () => {
    const terms = withLate({ mode: 'usury' }, { system: 'interest_only', n: 6 });
    const overdueInterest = run(terms, [], '2026-06-30');
    expect(overdueInterest.pastDueMinor).toBeGreaterThan(0);
    expect(overdueInterest.lateInterestMinor).toBe(0);
    const afterBullet = run(terms, [], '2026-08-15');
    expect(afterBullet.plan[5].lateMinor).toBeGreaterThan(0);
    expect(afterBullet.plan[5].lateBaseMinor).toBe(10_000_000);
  });

  it('a contract rate change splits the window: 5 days at 24% then 5 days at 20% on a 1x contract multiple', () => {
    const terms = withLate({ mode: 'contract_multiple', multiple: 1 });
    const events = [ev('rate_change', '2026-02-20', 0, { rate: EA(20), mode: 'keep_term' }, 'r1')];
    const projection = run(terms, events, '2026-02-25');
    expect(projection.plan[0].lateMinor).toBe(Math.round(199_505 * (dailyRate(24) * 5 + dailyRate(20) * 5)));
    expect(projection.plan[0].lateDays).toBe(10);
  });

  it('a payment dated on the due date accrues no mora and one dated the day after accrues one day', () => {
    expect(run(withLate({ mode: 'usury' }), [pay('2026-02-15', 390_381, 'p1')], '2026-02-28').lateInterestMinor).toBe(0);
    const oneDay = run(withLate({ mode: 'usury' }), [pay('2026-02-16', 390_381, 'p1')], '2026-02-16');
    expect(oneDay.applied[0].allocation.lateInterest).toBe(137);
    expect(oneDay.plan[0].lateDays).toBe(1);
  });

  it('a payment on the projection date gets the mora up to that date only', () => {
    const projection = run(withLate({ mode: 'usury' }), [pay('2026-02-25', 100_000, 'p1')], '2026-02-25');
    expect(projection.applied[0].allocation.lateInterest).toBe(1375);
    expect(projection.plan[0].lateDays).toBe(10);
  });

  it('a restructure refinances the arrears together with the mora accrued up to its date', () => {
    const restructured = (late) => {
      const next = french({ principalMinor: 7_000_000, n: 24, firstDueOn: '2026-04-15', openedOn: '2026-02-25', late });
      return run(withLate(late), [ev('restructure', '2026-02-25', 0, { terms: next }, 'rs1')], '2026-03-01');
    };
    const none = restructured({ mode: 'none' });
    const usury = restructured({ mode: 'usury' });
    expect(usury.applied[0].carriedMinor - none.applied[0].carriedMinor).toBe(1375);
    expect(usury.plan[0].refinancedMinor - none.plan[0].refinancedMinor).toBe(1375);
  });
});

describe('project: notices', () => {
  it('a carried cap raises late_cap_stale once, with the last valid day', () => {
    const projection = run(withLate({ mode: 'usury' }), [], '2026-03-30', legalOf(cap(28.59, '2026-01-01', '2026-02-20')));
    const stale = projection.notices.filter((notice) => notice.code === 'late_cap_stale');
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ modality: 'consumer', lastValidTo: '2026-02-20', blocking: false });
  });

  it('no cap at all raises late_cap_unknown once and accrues at the contract EA', () => {
    const projection = run(withLate({ mode: 'usury' }), [pay('2026-02-20', 100_000, 'p1')], '2026-03-30', legalOf());
    expect(projection.notices.filter((notice) => notice.code === 'late_cap_unknown')).toHaveLength(1);
    expect(projection.plan[0].lateMinor).toBeGreaterThan(0);
  });

  it('raises no cap notice while nothing is overdue, and none under mode none', () => {
    expect(run(withLate({ mode: 'usury' }), [], '2026-02-10', legalOf()).notices).toEqual([]);
    expect(run(withLate({ mode: 'none' }), [], '2026-09-30', legalOf()).notices).toEqual([]);
  });

  it('a mortgage with mora raises late_mortgage_unverified once, even before anything is overdue', () => {
    const mortgage = (late) => withLate(late, { kind: 'mortgage' });
    const codes = (projection) => projection.notices.map((notice) => notice.code);
    expect(codes(run(mortgage({ mode: 'usury' }), [], '2026-02-10', legalOf(cap(14.5, '2026-01-01', '2026-12-31', 'mortgage'))))).toEqual(['late_mortgage_unverified']);
    expect(codes(run(mortgage({ mode: 'usury' }), [], '2026-04-10', legalOf())).sort()).toEqual(['late_cap_unknown', 'late_mortgage_unverified']);
    expect(codes(run(mortgage({ mode: 'none' }), [], '2026-04-10', legalOf()))).toEqual([]);
    expect(codes(run(withLate({ mode: 'usury' }), [], '2026-02-10'))).toEqual([]);
  });

  it('keeps the existing notices (surplus) ahead of the mora ones', () => {
    const small = withLate({ mode: 'usury' }, { principalMinor: 300_000, n: 3, charges: [] });
    const total = buildSchedule(small).reduce((sum, row) => sum + row.totalDueMinor, 0);
    const projection = run(small, [pay('2026-02-16', total + 40_000, 'p1')], '2026-02-17', legalOf());
    expect(projection.notices.map((notice) => notice.code)).toEqual(['surplus', 'late_cap_unknown']);
  });
});

describe('project: interest-free and balance-only debts', () => {
  it('an interest-free loan with mode none projects no mora, and a fixed policy accrues on its principal', () => {
    const none = run(interestFree(), [], '2026-09-30');
    expect(none.lateInterestMinor).toBe(0);
    const fixed = run(interestFree({ late: { mode: 'fixed', rate: EA(12) } }), [], '2026-02-25', legalOf());
    expect(fixed.plan[0].lateMinor).toBe(Math.round(100_000 * dailyRate(12) * 10));
    expect(fixed.plan[0].lateBaseMinor).toBe(100_000);
  });

  it('a balance-only debt (system none) has no rows and so no mora', () => {
    const family = { kind: 'informal', principalMinor: 1_000_000, openedOn: '2026-01-10', rate: { convention: 'ZERO' }, system: 'none', late: { mode: 'fixed', rate: EA(12) } };
    const projection = run(family, [], '2026-09-30');
    expect(projection.plan).toEqual([]);
    expect(projection.lateInterestMinor).toBe(0);
    expect(projection.balanceMinor).toBe(1_000_000);
  });
});
