// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { project } from '../../src/ledger/project.js';
import { EA, debt, ev, french, interestFree } from '../helpers/loans.js';

// Approval test (DL7, spec "Golden parity"): a debt without `terms.late` must project exactly as it did
// before mora existed. Each scenario below was hashed on the code BEFORE the accrual engine landed
// (the JSON of the projection minus the new mora fields); the hash must never change. The new fields
// exist but must all be 0.

const FEE = { id: 'fee', kind: 'fee', label: 'Admin fee', basis: 'fixed', value: 10_000 };
const IVA = { id: 'iva', kind: 'tax', label: 'IVA', basis: 'pctOfCharge', refId: 'fee', value: 19 };
const pay = (on, amount, id, payload = {}) => ev('payment', on, amount, payload, id);

const MORA_PLAN_FIELDS = ['lateMinor', 'lateDays', 'lateBaseMinor'];

const withoutMora = (row) => {
  if (row === null) return row;
  const copy = { ...row };
  for (const key of MORA_PLAN_FIELDS) delete copy[key];
  return copy;
};

function stripMora(projection) {
  const { lateInterestMinor, totals, plan, nextDue, ...rest } = projection;
  const { remainingLateInterest, ...oldTotals } = totals;
  const moraFields = { lateInterestMinor, remainingLateInterest, plan: plan.map((row) => MORA_PLAN_FIELDS.map((key) => row[key])) };
  return { moraFields, old: { ...rest, nextDue: withoutMora(nextDue), totals: oldTotals, plan: plan.map(withoutMora) } };
}

const hashOf = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

const manual = french({ system: 'manual', n: undefined, manualPlan: [['2026-02-15', 500_000], ['2026-03-15', 500_000], ['2026-04-15', 9_500_000]] });
delete manual.firstDueOn;

const SCENARIOS = [
  { name: 'untouched French plan, far past due', terms: french({ charges: [FEE, IVA] }), events: [], asOf: '2026-09-30', hash: '9e3370648e83d54a' },
  {
    name: 'late and partial payments with a fee',
    terms: french({ charges: [FEE] }),
    events: [pay('2026-02-15', 390_381, 'p1'), pay('2026-03-30', 100_000, 'p2'), pay('2026-05-02', 800_000, 'p3')],
    asOf: '2026-08-01',
    hash: 'a7d7ee325f2480c2',
  },
  {
    name: 'bank-stated split and an extra payment',
    terms: french({ charges: [FEE, IVA] }),
    events: [
      pay('2026-02-15', 390_381, 'p1', { bankSplit: { charges: 10_000, taxes: 1_900, interest: 150_000, principal: 228_481 } }),
      ev('extra_payment', '2026-03-10', 1_000_000, { strategy: 'reduce_term' }, 'x1'),
    ],
    asOf: '2026-07-20',
    hash: '24f8e3ec76f0dc4a',
  },
  {
    name: 'rate change, charge change and restructure replayed',
    terms: french({ charges: [FEE] }),
    events: [
      pay('2026-02-15', 390_381, 'p1'),
      ev('rate_change', '2026-04-01', 0, { rate: EA(20), mode: 'keep_term' }, 'r1'),
      ev('charge_change', '2026-05-01', 0, { charges: [{ ...FEE, value: 12_000 }] }, 'c1'),
      ev('restructure', '2026-07-01', 0, { terms: french({ principalMinor: 7_000_000, n: 24, firstDueOn: '2026-08-15', openedOn: '2026-07-01', charges: [FEE] }) }, 'rs1'),
    ],
    asOf: '2026-11-30',
    hash: 'd668cadb136ad623',
  },
  { name: 'interest-free family loan with an adjustment', terms: interestFree(), events: [pay('2026-02-15', 100_000, 'p1'), ev('adjustment', '2026-03-01', 0, { balanceMinor: 900_000 }, 'a1')], asOf: '2026-12-31', hash: '09265629704b7fa3' },
  { name: 'manual plan unpaid', terms: manual, events: [pay('2026-02-20', 300_000, 'p1')], asOf: '2026-06-01', hash: 'c5e98beb2b3e47e5' },
  {
    name: 'balance-only debt',
    terms: { kind: 'informal', principalMinor: 1_000_000, openedOn: '2026-01-10', rate: { convention: 'ZERO' }, system: 'none' },
    events: [pay('2026-02-03', 250_000, 'p1')],
    asOf: '2026-06-01',
    hash: 'c02eeb5cceaefcb9',
  },
  { name: 'total grace period', terms: french({ principalMinor: 1_000_000, n: 6, grace: { periods: 2, type: 'total' }, charges: [FEE] }), events: [], asOf: '2026-09-01', hash: '87b84eb53af04a24' },
];

describe('project: parity with the pre-mora engine for debts without a late policy', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.name}: every pre-existing field is byte-identical and the mora fields are 0`, () => {
      const { old, moraFields } = stripMora(project(debt(scenario.terms), scenario.events, scenario.asOf));
      expect(hashOf(old)).toBe(scenario.hash);
      expect(moraFields.lateInterestMinor).toBe(0);
      expect(moraFields.remainingLateInterest).toBe(0);
      expect(moraFields.plan.every((fields) => fields.every((value) => value === 0))).toBe(true);
    });
  }

  it('the scenarios exercise real overdue debt (not trivially empty plans)', () => {
    const projection = project(debt(SCENARIOS[0].terms), SCENARIOS[0].events, SCENARIOS[0].asOf);
    expect(projection.pastDueMinor).toBeGreaterThan(2_000_000);
    expect(projection.plan.filter((row) => row.status === 'pastDue')).toHaveLength(8);
  });
});
