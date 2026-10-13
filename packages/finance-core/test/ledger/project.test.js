// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/errors.js';
import { project, registerProjector } from '../../src/ledger/project.js';
import { buildSchedule, summarizeSchedule } from '../../src/schedule/index.js';
import { serializeTerms } from '../../src/terms.js';
import { mulberry32 } from '../helpers/prng.js';

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
const FEE = { id: 'fee', kind: 'fee', label: 'Admin fee', basis: 'fixed', value: 10_000 };
const IVA = { id: 'iva', kind: 'tax', label: 'IVA', basis: 'pctOfCharge', refId: 'fee', value: 19 };

const debt = (terms, overrides = {}) => ({ $id: 'd1', householdId: 'h1', name: 'Crédito', ownerScope: 'shared', terms, ...overrides });
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
const statuses = (projection, count = 5) => projection.plan.slice(0, count).map((row) => row.status);

describe('project: plan rows and statuses', () => {
  const base = buildSchedule(french());
  const installment = base[0].installmentMinor;

  it('returns the full schedule with every row marked future when nothing is paid', () => {
    const projection = project(debt(french()), [], '2026-01-20');
    expect(projection.plan).toHaveLength(36);
    expect(projection.plan[0]).toMatchObject({ period: 1, dueOn: '2026-02-15', status: 'due', paidMinor: 0, outstandingMinor: installment, paidByEventIds: [] });
    expect(statuses(projection)).toEqual(['due', 'future', 'future', 'future', 'future']);
    expect(projection).toMatchObject({ asOf: '2026-01-20', termsVersion: 1, balanceMinor: 10_000_000, pastDueMinor: 0 });
    expect(projection.nextDue.period).toBe(1);
    expect(projection.applied).toEqual([]);
  });

  it('marks paid, partial, due and future rows when payments run ahead of the calendar', () => {
    const events = [pay('2026-02-14', installment, 'p1'), pay('2026-03-14', installment, 'p2'), pay('2026-04-01', 100_000, 'p3')];
    const projection = project(debt(french()), events, '2026-04-10');
    expect(statuses(projection)).toEqual(['paid', 'paid', 'partial', 'due', 'future']);
    expect(projection.plan[2]).toMatchObject({ paidMinor: 100_000, outstandingMinor: installment - 100_000, paidByEventIds: ['p3'] });
    expect(projection.pastDueMinor).toBe(0);
    expect(projection.nextDue.period).toBe(3);
    expect(projection.balanceMinor).toBe(10_000_000 - base[0].principalMinor - base[1].principalMinor);
  });

  it('marks overdue rows pastDue and sums them into pastDueMinor', () => {
    const events = [pay('2026-02-15', installment, 'p1'), pay('2026-03-16', 100_000, 'p2')];
    const projection = project(debt(french()), events, '2026-04-20');
    expect(statuses(projection)).toEqual(['paid', 'pastDue', 'pastDue', 'due', 'future']);
    expect(projection.plan[1]).toMatchObject({ paidMinor: 100_000, outstandingMinor: installment - 100_000 });
    expect(projection.pastDueMinor).toBe(installment - 100_000 + installment);
    expect(projection.nextDue.period).toBe(2);
  });

  it('a row due exactly on asOf is not past due yet', () => {
    expect(statuses(project(debt(french()), [], '2026-02-15'), 2)).toEqual(['due', 'future']);
    expect(statuses(project(debt(french()), [], '2026-02-16'), 2)).toEqual(['pastDue', 'due']);
  });

  it('ignores events dated after asOf', () => {
    const projection = project(debt(french()), [pay('2026-03-01', installment, 'p1')], '2026-02-20');
    expect(projection.applied).toEqual([]);
    expect(statuses(projection, 2)).toEqual(['pastDue', 'due']);
  });
});

describe('project: payment allocation across the plan', () => {
  const terms = french({ charges: [FEE, IVA] });
  const first = buildSchedule(terms)[0];

  it('a short payment covers charges and taxes, then interest, and leaves the rest due', () => {
    const projection = project(debt(terms), [pay('2026-02-15', 100_000, 'p1')], '2026-02-20');
    const { allocation, costMinor } = projection.applied[0];
    expect(first).toMatchObject({ chargesMinor: 10_000, taxesMinor: 1_900, interestMinor: 180_876, principalMinor: 199_505 });
    expect(allocation).toEqual({ charges: 10_000, taxes: 1_900, lateInterest: 0, interest: 88_100, principal: 0, surplus: 0 });
    expect(costMinor).toBe(100_000);
    expect(projection.plan[0]).toMatchObject({ status: 'pastDue', paidMinor: 100_000, outstandingMinor: first.totalDueMinor - 100_000 });
    expect(projection.totals).toMatchObject({ chargesPaid: 10_000, taxesPaid: 1_900, interestPaid: 88_100, principalPaid: 0 });
    expect(projection.totals.remainingInterest).toBe(summarizeSchedule(buildSchedule(terms)).interestMinor - 88_100);
  });

  it('a second payment finishes the row and spills the excess into the next one', () => {
    const rest = first.totalDueMinor - 100_000;
    const projection = project(debt(terms), [pay('2026-02-15', 100_000, 'p1'), pay('2026-03-01', rest + 50_000, 'p2')], '2026-03-02');
    expect(projection.plan[0]).toMatchObject({ status: 'paid', outstandingMinor: 0, paidByEventIds: ['p1', 'p2'] });
    expect(projection.plan[1]).toMatchObject({ paidMinor: 50_000, paidByEventIds: ['p2'] });
    // Row 1 still owed interest 92,776 and principal 199,505; the extra 50,000 pays row 2's fee, IVA and part of its interest.
    expect(projection.applied[1].allocation).toEqual({ charges: 10_000, taxes: 1_900, lateInterest: 0, interest: 92_776 + 38_100, principal: 199_505, surplus: 0 });
  });

  it('an exact payment equals the schedule row and the allocated total equals the amount', () => {
    const projection = project(debt(terms), [pay('2026-02-15', first.totalDueMinor, 'p1')], '2026-02-15');
    const { allocation, costMinor } = projection.applied[0];
    expect(allocation).toEqual({ charges: 10_000, taxes: 1_900, lateInterest: 0, interest: 180_876, principal: 199_505, surplus: 0 });
    expect(costMinor).toBe(10_000 + 1_900 + 180_876);
    expect(projection.plan[0].status).toBe('paid');
    expect(projection.totals).toMatchObject({ interestPaid: 180_876, principalPaid: 199_505 });
  });

  it('honours a custom allocationOrder from the terms', () => {
    const custom = french({ charges: [FEE], allocationOrder: ['principal', 'interest'] });
    const { allocation } = project(debt(custom), [pay('2026-02-15', 100_000, 'p1')], '2026-02-15').applied[0];
    expect(allocation).toMatchObject({ principal: 100_000, interest: 0, charges: 0 });
  });

  it('a bank-stated split overrides the order and carries what does not fit to the next row', () => {
    const split = { charges: 10_000, taxes: 1_900, interest: 150_000, principal: 228_481 };
    const projection = project(debt(terms), [ev('payment', '2026-02-15', 390_381, { bankSplit: split }, 'p1')], '2026-02-15');
    expect(projection.applied[0].allocation).toEqual({ charges: 10_000, taxes: 1_900, lateInterest: 0, interest: 150_000, principal: 228_481, surplus: 0 });
    expect(projection.plan[0]).toMatchObject({ outstandingMinor: 30_876, status: 'partial' });
    expect(projection.plan[1]).toMatchObject({ paidMinor: 228_481 - 199_505, paidByEventIds: ['p1'] });
  });

  it('records the surplus when a payment exceeds everything owed and keeps the balance at 0', () => {
    const small = french({ principalMinor: 300_000, n: 3 });
    const total = buildSchedule(small).reduce((sum, row) => sum + row.totalDueMinor, 0);
    const projection = project(debt(small), [pay('2026-02-15', total + 40_000, 'p1')], '2026-02-16');
    expect(projection.applied[0].allocation.surplus).toBe(40_000);
    expect(projection).toMatchObject({ balanceMinor: 0, pastDueMinor: 0, nextDue: null });
    expect(projection.plan.every((row) => row.status === 'paid')).toBe(true);
    expect(projection.notices).toEqual([{ code: 'surplus', eventId: 'p1', amountMinor: 40_000 }]);
  });
});

describe('project: balance and negative-amortization rows', () => {
  it('adds capitalized interest to the balance only once its period has passed (total grace)', () => {
    const terms = french({ principalMinor: 1_000_000, n: 6, grace: { periods: 2, type: 'total' } });
    const rows = buildSchedule(terms);
    expect(rows[0].installmentMinor).toBe(0);
    expect(project(debt(terms), [], '2026-01-31').balanceMinor).toBe(1_000_000);
    expect(project(debt(terms), [], '2026-02-15').balanceMinor).toBe(rows[1].openingMinor);
    expect(project(debt(terms), [], '2026-03-15').balanceMinor).toBe(rows[2].openingMinor);
    expect(rows[2].openingMinor).toBeGreaterThan(1_000_000);
    // Grace rows owe nothing, so they are never past due.
    expect(statuses(project(debt(terms), [], '2026-03-20'), 4)).toEqual(['paid', 'paid', 'due', 'future']);
  });

  it('a total-grace row with a fee only owes the fee', () => {
    const terms = french({ principalMinor: 1_000_000, n: 6, grace: { periods: 2, type: 'total' }, charges: [FEE] });
    const projection = project(debt(terms), [pay('2026-02-15', 10_000, 'p1')], '2026-02-16');
    expect(projection.plan[0]).toMatchObject({ status: 'paid', paidMinor: 10_000 });
    expect(projection.applied[0].allocation).toMatchObject({ charges: 10_000, interest: 0, principal: 0 });
  });
});

describe('project: balance-only debts (system none)', () => {
  const family = { kind: 'informal', principalMinor: 1_000_000, openedOn: '2026-01-10', rate: { convention: 'ZERO' }, system: 'none' };

  it('balance is principal minus payments of any size and date, never below 0', () => {
    const events = [pay('2026-02-03', 250_000, 'p1'), pay('2026-02-20', 100_000, 'p2'), pay('2026-05-01', 800_000, 'p3')];
    const early = project(debt(family), events, '2026-02-25');
    expect(early).toMatchObject({ balanceMinor: 650_000, plan: [], nextDue: null, pastDueMinor: 0 });
    expect(early.applied.map((entry) => entry.allocation.principal)).toEqual([250_000, 100_000]);
    const late = project(debt(family), events, '2026-06-01');
    expect(late.balanceMinor).toBe(0);
    expect(late.applied[2].allocation).toMatchObject({ principal: 650_000, surplus: 150_000 });
    expect(late.totals.principalPaid).toBe(1_000_000);
  });

  it('a payment on a debt with nothing left is all surplus', () => {
    const projection = project(debt(family), [pay('2026-02-03', 1_000_000, 'p1'), pay('2026-02-04', 5_000, 'p2')], '2026-02-10');
    expect(projection.applied[1].allocation).toMatchObject({ principal: 0, surplus: 5_000 });
  });
});

describe('project: determinism', () => {
  const terms = french({ charges: [FEE] });
  const random = mulberry32(99);
  const pick = (max) => Math.floor(random() * max);
  const randomPayment = (id) => pay(`2026-${String(2 + pick(10)).padStart(2, '0')}-${String(1 + pick(28)).padStart(2, '0')}`, 50_000 + pick(750_000), id);

  it('voiding a payment restores the projection (200 seeded cases)', () => {
    let changed = 0;
    for (let round = 0; round < 200; round += 1) {
      const events = Array.from({ length: pick(4) }, (_, index) => randomPayment(`b${round}-${index}`));
      const target = randomPayment(`t${round}`);
      const voidEvent = ev('void', '2027-03-01', 0, { targetEventId: target.$id, reason: 'typo' }, `v${round}`);
      const before = project(debt(terms), events, '2027-06-30');
      const voided = project(debt(terms), [...events, target, voidEvent], '2027-06-30');
      const withPayment = project(debt(terms), [...events, target], '2027-06-30');
      expect(voided).toEqual(before);
      if (withPayment.balanceMinor !== before.balanceMinor || withPayment.pastDueMinor !== before.pastDueMinor) changed += 1;
    }
    expect(changed).toBeGreaterThan(150);
  });

  it('projects the same state for any storage order, including same-day events', () => {
    const events = [
      pay('2026-03-01', 200_000, 'a'),
      pay('2026-03-01', 90_000, 'b'),
      pay('2026-03-01', 410_000, 'c'),
      pay('2026-02-10', 400_000, 'd'),
      ev('void', '2026-04-01', 0, { targetEventId: 'b' }, 'v'),
    ].map((event, index) => ({ ...event, $createdAt: `2026-03-01T10:00:0${index}.000Z` }));
    const expected = project(debt(terms), events, '2026-05-01');
    expect(expected.applied.map((entry) => entry.eventId)).toEqual(['d', 'a', 'c']);
    for (let round = 0; round < 25; round += 1) {
      const shuffled = events.slice();
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swap = pick(index + 1);
        [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
      }
      expect(project(debt(terms), shuffled, '2026-05-01')).toEqual(expected);
    }
  });

  it('replaying twice gives deeply equal results and does not mutate its inputs', () => {
    const events = [pay('2026-02-15', 300_000, 'a'), pay('2026-03-15', 300_000, 'b')];
    const snapshot = JSON.stringify([debt(terms), events]);
    const first = project(debt(terms), events, '2026-04-01');
    const second = project(debt(terms), events, '2026-04-01');
    expect(second).toEqual(first);
    expect(JSON.stringify([debt(terms), events])).toBe(snapshot);
  });

  it('reads the terms from termsJson as stored in the debts table', () => {
    const stored = { $id: 'd1', name: 'Crédito', ownerScope: 'shared', termsJson: serializeTerms(terms), termsVersion: 1 };
    expect(project(stored, [pay('2026-02-15', 100_000, 'a')], '2026-03-01')).toEqual(project(debt(terms), [pay('2026-02-15', 100_000, 'a')], '2026-03-01'));
  });

  it('rejects an invalid asOf or malformed events', () => {
    expect(() => project(debt(terms), [], '2026-13-01')).toThrow(ValidationError);
    // An unknown string kind is skipped with a notice (DL1); a malformed event still throws.
    expect(() => project(debt(terms), [{ ...pay('2026-02-15', 1, 'a'), kind: 7 }], '2026-03-01')).toThrow(ValidationError);
    expect(() => project(debt(terms), [pay('2026-02-15', -1, 'a')], '2026-03-01')).toThrow(ValidationError);
    expect(() => project({ $id: 'd1' }, [], '2026-03-01')).toThrow(ValidationError);
  });
});

describe('registerProjector', () => {
  it('dispatches by debt kind and falls back to the loan projector when unregistered', () => {
    const calls = [];
    registerProjector('vehicle', (context) => {
      calls.push(context);
      return { custom: true, count: context.events.length };
    });
    try {
      const events = [pay('2026-02-15', 100_000, 'a')];
      expect(project(debt(french({ kind: 'vehicle' })), events, '2026-03-01')).toEqual({ custom: true, count: 1 });
      expect(calls[0]).toMatchObject({ asOf: '2026-03-01', terms: { kind: 'vehicle' }, events: [{ id: 'a' }] });
      expect(project(debt(french()), events, '2026-03-01').custom).toBeUndefined();
    } finally {
      registerProjector('vehicle', null);
    }
    expect(project(debt(french({ kind: 'vehicle' })), [], '2026-03-01').plan).toHaveLength(36);
  });

  it('rejects a projector that is not a function', () => {
    expect(() => registerProjector('card', 'nope')).toThrow(ValidationError);
  });
});
