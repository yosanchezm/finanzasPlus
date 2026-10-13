// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { addDays } from '../../src/calendar.js';
import { project } from '../../src/ledger/project.js';
import { buildSchedule } from '../../src/schedule/index.js';
import { mulberry32 } from '../helpers/prng.js';

// Events that change the plan itself: extra payments, rate and charge changes,
// restructures and adjustments (DL-4, DL-2). payments are covered in project.test.js.

const EA = (value) => ({ value, basis: 'effective', periodicity: 'annual', timing: 'arrears' });
const french = (overrides = {}) => ({
  kind: 'consumer',
  principalMinor: 10_000_000,
  openedOn: '2026-01-15',
  rate: EA(24),
  system: 'french',
  periodicity: 'monthly',
  n: 36,
  firstDueOn: '2026-02-15',
  ...overrides,
});
const interestFree = (overrides = {}) =>
  french({ kind: 'family', principalMinor: 1_200_000, n: 12, rate: { convention: 'ZERO' }, ...overrides });
const FEE = { id: 'fee', kind: 'fee', label: 'Admin fee', basis: 'fixed', value: 10_000 };

const debt = (terms) => ({ $id: 'd1', householdId: 'h1', name: 'Crédito', ownerScope: 'shared', terms });
let counter = 0;
const ev = (kind, effectiveOn, amountMinor, payload = {}, id = `e${(counter += 1)}`) => ({
  $id: id,
  debtId: 'd1',
  kind,
  effectiveOn,
  amountMinor,
  payloadJson: JSON.stringify(payload),
  $createdAt: '2026-01-01T00:00:00.000Z',
});
const pay = (effectiveOn, amountMinor, id) => ev('payment', effectiveOn, amountMinor, {}, id);
const extra = (effectiveOn, amountMinor, strategy, id) => ev('extra_payment', effectiveOn, amountMinor, { strategy }, id);
const rateChange = (effectiveOn, rate, mode, id) => ev('rate_change', effectiveOn, 0, { rate, mode }, id);
const onTime = (terms, count) => buildSchedule(terms).slice(0, count).map((row, index) => pay(row.dueOn, row.totalDueMinor, `on${index + 1}`));
const shape = (rows) => rows.map((row) => ({ period: row.period, dueOn: row.dueOn, openingMinor: row.openingMinor, interestMinor: row.interestMinor, principalMinor: row.principalMinor, installmentMinor: row.installmentMinor, closingMinor: row.closingMinor }));
const lifetimeInterest = (projection) => projection.totals.interestPaid + projection.totals.remainingInterest;

describe('extra_payment on an interest-free loan (1,200,000 x 12, one installment paid)', () => {
  const events = [pay('2026-02-15', 100_000, 'p1')];
  const run = (amount, strategy, date = '2026-03-01') => project(debt(interestFree()), [...events, extra(date, amount, strategy, 'x1')], '2026-03-02');

  it('reduce term keeps the 100,000 installment and leaves 8 installments', () => {
    const projection = run(300_000, 'reduce_term');
    expect(projection.plan).toHaveLength(9);
    expect(projection.remainingPeriods).toBe(8);
    expect(projection.plan.slice(1).every((row) => row.installmentMinor === 100_000)).toBe(true);
    expect(projection.plan[8]).toMatchObject({ period: 9, dueOn: '2026-10-15', closingMinor: 0 });
    expect(projection.balanceMinor).toBe(800_000);
    expect(projection.applied[1]).toMatchObject({ kind: 'extra_payment', costMinor: 0, extraPrincipalMinor: 300_000 });
    expect(projection.applied[1].allocation).toEqual({ charges: 0, taxes: 0, lateInterest: 0, interest: 0, principal: 300_000, surplus: 0 });
    expect(projection.totals.principalPaid).toBe(400_000);
  });

  it('reduce installment keeps 11 installments of about 72,727, the last absorbing the residue', () => {
    const projection = run(300_000, 'reduce_installment');
    expect(projection.plan).toHaveLength(12);
    expect(projection.remainingPeriods).toBe(11);
    expect(projection.plan.slice(1, 11).every((row) => row.installmentMinor === 72_727)).toBe(true);
    expect(projection.plan[11]).toMatchObject({ installmentMinor: 800_000 - 10 * 72_727, closingMinor: 0 });
    expect(projection.balanceMinor).toBe(800_000);
  });

  it('advance installments pays the next installments as scheduled and changes no row', () => {
    const projection = run(300_000, 'advance_installments');
    expect(projection.plan).toHaveLength(12);
    expect(projection.plan.slice(1, 4).map((row) => row.status)).toEqual(['paid', 'paid', 'paid']);
    expect(projection.remainingPeriods).toBe(8);
    expect(projection.plan.every((row) => row.installmentMinor === 100_000)).toBe(true);
    expect(projection.applied[1].extraPrincipalMinor).toBeUndefined();
  });

  it('triangulates: an extra that is not a multiple of the installment ends with a smaller last row', () => {
    const projection = run(250_000, 'reduce_term');
    expect(projection.plan.slice(1).map((row) => row.installmentMinor)).toEqual([...Array(8).fill(100_000), 50_000]);
    expect(projection.remainingPeriods).toBe(9);
  });

  it('first pays what is already due, and only the rest is extra principal', () => {
    const projection = project(debt(interestFree()), [extra('2026-02-20', 300_000, 'reduce_term', 'x1')], '2026-02-21');
    expect(projection.plan[0]).toMatchObject({ status: 'paid', paidByEventIds: ['x1'] });
    expect(projection.applied[0].extraPrincipalMinor).toBe(200_000);
    expect(projection.applied[0].allocation.principal).toBe(300_000);
    expect(projection.plan).toHaveLength(10);
    expect(projection.balanceMinor).toBe(900_000);
  });

  it('caps at the balance: the debt is paid off and the rest is surplus', () => {
    const small = interestFree({ principalMinor: 300_000, n: 3 });
    const projection = project(debt(small), [extra('2026-02-01', 1_000_000, 'reduce_term', 'x1')], '2026-02-02');
    expect(projection.applied[0].allocation).toMatchObject({ principal: 300_000, surplus: 700_000 });
    expect(projection).toMatchObject({ plan: [], balanceMinor: 0, nextDue: null, remainingPeriods: 0 });
  });

  it('acts as a plain payment on a balance-only debt', () => {
    const informal = { kind: 'informal', principalMinor: 500_000, openedOn: '2026-01-10', rate: { convention: 'ZERO' }, system: 'none' };
    const projection = project(debt(informal), [extra('2026-02-01', 200_000, 'reduce_term', 'x1')], '2026-02-02');
    expect(projection.balanceMinor).toBe(300_000);
  });
});

describe('extra_payment on a 24% EA loan (10,000,000 x 36, 12 paid on time, 2,000,000 extra)', () => {
  const payments = onTime(french(), 12);
  const at = (strategy) => project(debt(french()), [...payments, extra('2027-01-20', 2_000_000, strategy, 'x1')], '2027-01-25');
  const baseline = project(debt(french()), payments, '2027-01-25');

  it('reduce term: same installment, fewer installments', () => {
    const projection = at('reduce_term');
    expect(projection.plan.length).toBeLessThan(36);
    expect(projection.plan[12].installmentMinor).toBe(380_381);
    expect(projection.plan.slice(12, -1).every((row) => row.installmentMinor === 380_381)).toBe(true);
    expect(projection.plan[projection.plan.length - 1].installmentMinor).toBeLessThanOrEqual(380_381);
    expect(projection.balanceMinor).toBe(baseline.balanceMinor - 2_000_000);
    expect(projection.remainingPeriods).toBe(projection.plan.length - 12);
  });

  it('reduce installment: same term, lower installment', () => {
    const projection = at('reduce_installment');
    expect(projection.plan).toHaveLength(36);
    expect(projection.plan[12].installmentMinor).toBeLessThan(380_381);
    expect(projection.balanceMinor).toBe(baseline.balanceMinor - 2_000_000);
  });

  it('saves more interest by reducing the term; advancing installments saves none', () => {
    const [term, installment, advance] = ['reduce_term', 'reduce_installment', 'advance_installments'].map(at);
    expect(lifetimeInterest(advance)).toBe(lifetimeInterest(baseline));
    expect(lifetimeInterest(installment)).toBeLessThan(lifetimeInterest(baseline));
    expect(lifetimeInterest(term)).toBeLessThan(lifetimeInterest(installment));
    expect(advance.plan).toHaveLength(36);
  });
});

describe('rate_change', () => {
  const base = buildSchedule(french());
  const paid = onTime(french(), 3);
  const run = (rate, mode, events = paid, date = '2026-05-10') => project(debt(french()), [...events, rateChange(date, rate, mode, 'r1')], '2026-05-11');

  it('keep term: rows already due keep their figures, the rest is rebuilt at the new rate from the next installment', () => {
    const projection = run(EA(30), 'keep_term');
    expect(projection.plan).toHaveLength(36);
    expect(shape(projection.plan.slice(0, 3))).toEqual(shape(base.slice(0, 3)));
    const rebuilt = buildSchedule(french({ rate: EA(30) }), { fromPeriod: 4, balanceMinor: base[2].closingMinor });
    expect(shape(projection.plan.slice(3))).toEqual(shape(rebuilt));
    expect(projection.plan[3].installmentMinor).toBeGreaterThan(380_381);
    expect(projection.terms.rate).toEqual(EA(30));
    expect(projection.balanceMinor).toBe(base[2].closingMinor);
  });

  it('keep installment with a lower rate: same installment, fewer installments', () => {
    const projection = run(EA(18), 'keep_installment');
    expect(projection.plan.length).toBeLessThan(36);
    expect(projection.plan.slice(3, -1).every((row) => row.installmentMinor === 380_381)).toBe(true);
    expect(projection.plan[projection.plan.length - 1].closingMinor).toBe(0);
  });

  it('keep installment with a higher rate: the calendar runs past the original term', () => {
    const projection = run(EA(30), 'keep_installment');
    expect(projection.plan.length).toBeGreaterThan(36);
    expect(projection.plan[36].dueOn).toBe('2029-02-15');
    expect(projection.plan[projection.plan.length - 1].closingMinor).toBe(0);
    expect(projection.remainingPeriods).toBe(projection.plan.length - 3);
  });

  it('does not rewrite installments that were paid in advance', () => {
    const early = base.slice(0, 5).map((row, index) => pay('2026-02-01', row.totalDueMinor, `a${index}`));
    const projection = run(EA(30), 'keep_term', early, '2026-03-01');
    expect(shape(projection.plan.slice(0, 5))).toEqual(shape(base.slice(0, 5)));
    expect(shape(projection.plan.slice(5))).toEqual(shape(buildSchedule(french({ rate: EA(30) }), { fromPeriod: 6, balanceMinor: base[4].closingMinor })));
  });

  it('later payments follow the new rows, and a rate change after the last installment only updates the rate', () => {
    const next = pay('2026-05-25', run(EA(30), 'keep_term').plan[3].installmentMinor, 'p4');
    const projection = project(debt(french()), [...paid, rateChange('2026-05-10', EA(30), 'keep_term', 'r1'), next], '2026-05-26');
    expect(projection.plan[3]).toMatchObject({ status: 'paid', paidMinor: next.amountMinor });
    expect(projection.applied[4].allocation.interest).toBe(projection.plan[3].interestMinor);
    const all = onTime(french(), 36);
    const done = project(debt(french()), [...all, rateChange('2029-02-01', EA(30), 'keep_term', 'r2')], '2029-02-02');
    expect(done).toMatchObject({ balanceMinor: 0, remainingPeriods: 0 });
    expect(done.terms.rate).toEqual(EA(30));
  });
});

describe('charge_change', () => {
  const terms = french({ charges: [FEE] });
  const insurance = { id: 'ins', kind: 'insurance', label: 'Life insurance', basis: 'pctOutstanding', value: 0.05 };

  it('replaces the charge set from the effective date without touching rows already due or the amortization', () => {
    const base = buildSchedule(terms);
    const change = ev('charge_change', '2026-03-20', 0, { charges: [insurance] }, 'c1');
    const projection = project(debt(terms), [...onTime(terms, 2), change], '2026-03-21');
    expect(projection.plan.slice(0, 2).every((row) => row.chargesMinor === 10_000)).toBe(true);
    expect(projection.plan.slice(2).every((row) => row.charges.length === 1 && row.charges[0].id === 'ins')).toBe(true);
    expect(projection.plan[2].chargesMinor).toBe(Math.round(base[2].openingMinor * 0.0005));
    expect(projection.plan[2].totalDueMinor).toBe(base[2].installmentMinor + projection.plan[2].chargesMinor);
    expect(projection.plan.map((row) => row.installmentMinor)).toEqual(base.map((row) => row.installmentMinor));
    expect(projection.terms.charges.map((charge) => charge.id)).toEqual(['ins']);
    expect(projection.totals.remainingCharges).toBe(projection.plan.slice(2).reduce((sum, row) => sum + row.chargesMinor, 0));
  });

  it('an empty set removes the charges from the following rows', () => {
    const projection = project(debt(terms), [ev('charge_change', '2026-03-20', 0, { charges: [] }, 'c1')], '2026-03-21');
    expect(projection.plan.slice(0, 2).every((row) => row.chargesMinor === 10_000)).toBe(true);
    expect(projection.plan.slice(2).every((row) => row.chargesMinor === 0 && row.charges.length === 0)).toBe(true);
  });

  it('keeps the charges of installments that already have a payment applied', () => {
    const ahead = pay('2026-03-01', buildSchedule(terms)[0].totalDueMinor * 3, 'a1');
    const projection = project(debt(terms), [ahead, ev('charge_change', '2026-03-20', 0, { charges: [] }, 'c1')], '2026-03-21');
    expect(projection.plan.slice(0, 3).every((row) => row.chargesMinor === 10_000)).toBe(true);
    expect(projection.plan[3].chargesMinor).toBe(0);
  });
});

describe('restructure', () => {
  const terms = french({ principalMinor: 5_000_000, n: 12 });
  const base = buildSchedule(terms);
  const payments = onTime(terms, 2);
  const newTerms = french({ openedOn: '2026-05-10', principalMinor: 5_000_000, rate: EA(20), n: 10, firstDueOn: '2026-06-15' });
  const restructure = ev('restructure', '2026-05-10', 0, { terms: newTerms }, 'rs');

  it('starts a new terms version that carries the whole balance, arrears included', () => {
    const before = project(debt(terms), payments, '2026-05-10');
    expect(before.plan.slice(0, 4).map((row) => row.status)).toEqual(['paid', 'paid', 'pastDue', 'due']);
    const after = project(debt(terms), [...payments, restructure], '2026-05-10');
    const carried = before.balanceMinor + base[2].interestMinor;
    expect(after.termsVersion).toBe(2);
    expect(after.plan).toHaveLength(13);
    expect(after.plan[2]).toMatchObject({ status: 'paid', outstandingMinor: 0, refinancedMinor: base[2].totalDueMinor });
    expect(after.plan.slice(3).map((row) => row.period)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(after.plan[3]).toMatchObject({ dueOn: '2026-06-15', openingMinor: carried });
    expect(after.plan.slice(3).reduce((sum, row) => sum + row.principalMinor, 0)).toBe(carried);
    expect(after).toMatchObject({ balanceMinor: carried, pastDueMinor: 0, remainingPeriods: 10 });
    expect(after.terms).toMatchObject({ n: 10, rate: EA(20) });
  });

  it('later payments, rate changes and extra payments act on the new plan', () => {
    const first = project(debt(terms), [...payments, restructure], '2026-06-01').plan[3];
    const events = [...payments, restructure, pay('2026-06-15', first.totalDueMinor, 'np1'), rateChange('2026-07-01', EA(25), 'keep_term', 'r1')];
    const projection = project(debt(terms), events, '2026-07-02');
    expect(projection.plan[3].status).toBe('paid');
    expect(projection.plan.slice(3).map((row) => row.period)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(projection.plan[4].installmentMinor).not.toBe(first.installmentMinor);
    expect(projection.plan[12].closingMinor).toBe(0);
    const withExtra = project(debt(terms), [...events, extra('2026-07-02', 1_000_000, 'reduce_term', 'x1')], '2026-07-03');
    expect(withExtra.plan.length).toBeLessThan(13);
    expect(withExtra.plan[withExtra.plan.length - 1].closingMinor).toBe(0);
  });

  it('drops rows paid in advance but keeps the balance they reduced', () => {
    const ahead = pay('2026-02-01', base[0].totalDueMinor * 3, 'a1');
    const projection = project(debt(terms), [ahead, ev('restructure', '2026-02-10', 0, { terms: newTerms }, 'rs')], '2026-02-11');
    expect(projection.plan).toHaveLength(10);
    expect(projection.plan[0].openingMinor).toBe(base[2].closingMinor);
    expect(projection.balanceMinor).toBe(base[2].closingMinor);
    expect(projection.totals.principalPaid).toBe(base[0].principalMinor + base[1].principalMinor + base[2].principalMinor);
  });

  it('can turn the debt into a balance-only one', () => {
    const informal = { ...newTerms, system: 'none', kind: 'informal' };
    const flat = ev('restructure', '2026-05-10', 0, { terms: informal }, 'rs');
    const projection = project(debt(terms), [...payments, flat, pay('2026-06-01', 100_000, 'np1')], '2026-06-02');
    const carried = project(debt(terms), payments, '2026-05-10').balanceMinor + base[2].interestMinor;
    expect(projection.balanceMinor).toBe(carried - 100_000);
    expect(projection.plan.every((row) => row.refinancedMinor > 0 || row.status === 'paid')).toBe(true);
  });
});

describe('adjustment (the statement is the truth; the difference is recorded as drift)', () => {
  const payments = onTime(french(), 3);
  const before = project(debt(french()), payments, '2026-05-20');
  const adjust = (balanceMinor, date = '2026-05-20') => ev('adjustment', date, 0, { balanceMinor, note: 'statement' }, 'ad');

  it('records the drift and rebuilds the following installments from the stated balance', () => {
    const projection = project(debt(french()), [...payments, adjust(before.balanceMinor + 5_000)], '2026-05-20');
    expect(projection.applied[3]).toMatchObject({ kind: 'adjustment', driftMinor: 5_000, costMinor: 0, allocation: null });
    expect(projection.balanceMinor).toBe(before.balanceMinor + 5_000);
    expect(projection.remainingPeriods).toBe(before.remainingPeriods);
    expect(projection.plan[35].closingMinor).toBe(0);
    expect(projection.notices).toEqual([{ code: 'drift', eventId: 'ad', amountMinor: 5_000, absorbed: true }]);
  });

  it('works with negative drift', () => {
    const projection = project(debt(french()), [...payments, adjust(before.balanceMinor - 12_000)], '2026-05-20');
    expect(projection.applied[3].driftMinor).toBe(-12_000);
    expect(projection.balanceMinor).toBe(before.balanceMinor - 12_000);
  });

  it('is a no-op when the statement agrees, or when it carries no balance', () => {
    const agree = project(debt(french()), [...payments, adjust(before.balanceMinor)], '2026-05-20');
    expect(agree.applied[3].driftMinor).toBe(0);
    expect(agree.plan).toEqual(before.plan);
    expect(agree.notices).toEqual([]);
    const silent = project(debt(french()), [...payments, ev('adjustment', '2026-05-20', 0, { note: 'minimum due only', minimumDueMinor: 400_000 }, 'ad')], '2026-05-20');
    expect(silent.applied[3].driftMinor).toBeUndefined();
    expect(silent.plan).toEqual(before.plan);
  });

  it('sets the balance of a balance-only debt', () => {
    const informal = { kind: 'informal', principalMinor: 500_000, openedOn: '2026-01-10', rate: { convention: 'ZERO' }, system: 'none' };
    const projection = project(debt(informal), [pay('2026-02-01', 100_000, 'p1'), adjust(450_000, '2026-03-01')], '2026-03-02');
    expect(projection.applied[1].driftMinor).toBe(50_000);
    expect(projection.balanceMinor).toBe(450_000);
  });

  it('reports drift it cannot absorb when no installment is left to rebuild', () => {
    const small = french({ principalMinor: 300_000, n: 3 });
    const projection = project(debt(small), [adjust(500_000, '2026-06-01')], '2026-06-02');
    expect(projection.notices).toEqual([{ code: 'drift', eventId: 'ad', amountMinor: projection.applied[0].driftMinor, absorbed: false }]);
    expect(projection.applied[0].driftMinor).toBeGreaterThan(0);
  });
});

describe('project: seeded invariants with plan-changing events (200 cases)', () => {
  it('keeps the plan well formed and voiding the last change restores the projection', () => {
    const random = mulberry32(31337);
    const pick = (max) => Math.floor(random() * max);
    const seen = { reduce_term: 0, reduce_installment: 0, advance_installments: 0, rate_up: 0, rate_down: 0, charge_change: 0, closed: 0 };
    for (let round = 0; round < 200; round += 1) {
      const system = pick(2) === 0 ? 'french' : 'german';
      const baseRate = 8 + pick(20);
      const terms = french({
        system,
        principalMinor: 1_000_000 + pick(19_000_000),
        rate: EA(baseRate),
        n: 12 + pick(48),
        charges: pick(2) === 0 ? [] : [FEE],
      });
      const rows = buildSchedule(terms);
      const paidCount = 1 + pick(6);
      const events = onTime(terms, paidCount);
      let date = addDays(rows[paidCount - 1].dueOn, 5);
      let change;
      for (let step = 0; step < 1 + pick(2); step += 1) {
        const kind = pick(3);
        if (kind === 0) {
          const strategy = ['reduce_term', 'reduce_installment', 'advance_installments'][pick(3)];
          seen[strategy] += 1;
          change = extra(date, 100_000 + pick(2_000_000), strategy, `c${step}`);
        } else if (kind === 1) {
          const lower = pick(2) === 0;
          const rate = lower ? baseRate - 5 : baseRate + 6;
          seen[lower ? 'rate_down' : 'rate_up'] += 1;
          change = rateChange(date, EA(rate), lower ? 'keep_installment' : 'keep_term', `c${step}`);
        } else {
          seen.charge_change += 1;
          change = ev('charge_change', date, 0, { charges: [FEE] }, `c${step}`);
        }
        events.push(change);
        date = addDays(date, 3);
      }
      const asOf = '2031-12-31';
      const full = project(debt(terms), events, asOf);
      const { plan } = full;
      expect(plan.map((row) => row.period)).toEqual(plan.map((_, index) => index + 1));
      for (let index = 0; index < plan.length; index += 1) {
        const row = plan[index];
        expect([row.interestMinor, row.installmentMinor, row.chargesMinor, row.openingMinor, row.closingMinor].every((value) => Number.isInteger(value) && value >= 0)).toBe(true);
        if (index > 0) {
          expect(row.dueOn > plan[index - 1].dueOn).toBe(true);
          expect(row.openingMinor).toBeLessThanOrEqual(plan[index - 1].closingMinor);
        }
      }
      // A prepayment that clears the debt removes the tail; the rows kept are history and keep their scheduled closing.
      if (full.balanceMinor > 0) {
        seen.closed += 1;
        expect(plan[plan.length - 1].closingMinor).toBe(0);
      }
      for (const entry of full.applied) {
        if (entry.allocation) {
          const { surplus, ...buckets } = entry.allocation;
          const amount = events.find((event) => event.$id === entry.eventId).amountMinor;
          expect(Object.values(buckets).reduce((sum, value) => sum + value, 0) + surplus).toBe(amount);
        }
      }
      expect(project(debt(terms), events, asOf)).toEqual(full);
      const voided = project(debt(terms), [...events, ev('void', date, 0, { targetEventId: change.$id, reason: 'x' }, 'vv')], asOf);
      expect(voided).toEqual(project(debt(terms), events.filter((event) => event !== change), asOf));
    }
    expect(Object.values(seen).every((count) => count >= 15)).toBe(true);
    expect(seen.closed).toBeGreaterThan(150);
  });
});
