// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cycleDates, minimumPayment } from '../../src/card/card.js';
import { project } from '../../src/ledger/project.js';
import { mulberry32 } from '../helpers/prng.js';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/card-statement-independent.json', import.meta.url), 'utf8'));

const EA = (value) => ({ value, basis: 'effective', periodicity: 'annual', timing: 'arrears' });
const terms = (overrides = {}, card = {}) => ({ ...fixture.terms, ...overrides, card: { ...fixture.terms.card, ...card } });
const debt = (t = terms()) => ({ $id: 'card1', householdId: 'h1', name: 'Visa', ownerScope: 'shared', terms: t });
let counter = 0;
const ev = (kind, effectiveOn, amountMinor, payload = {}, id = `e${(counter += 1)}`) => ({
  $id: id,
  debtId: 'card1',
  kind,
  effectiveOn,
  amountMinor,
  payloadJson: JSON.stringify(payload),
  $createdAt: '2026-01-01T00:00:00.000Z',
});
const pay = (on, amount, id) => ev('payment', on, amount, {}, id);
const adjust = (on, payload, id) => ev('adjustment', on, 0, { note: 'extracto', ...payload }, id);
const row = (projection, period) => projection.plan.find((entry) => entry.period === period);
const tranche = (projection, id) => projection.tranches.find((entry) => entry.id === id);
const s1 = fixture.statement1;

describe('minimumPayment', () => {
  const cycle = { contractualMinor: 121_102, revolvingMinor: 500_000, payInFullMinor: 621_102, unit: 1 };

  it('adds a portion of the revolving balance to interest, fees and installments by default', () => {
    expect(minimumPayment({ rule: 'interest_fees_plus_pct', pct: 5, floorMinor: 0 }, cycle)).toBe(s1.minimumMinor);
    expect(minimumPayment({ rule: 'interest_fees_plus_pct', pct: 10, floorMinor: 0 }, cycle)).toBe(171_102);
  });

  it('supports the other two rules', () => {
    expect(minimumPayment({ rule: 'installments_due', floorMinor: 0 }, cycle)).toBe(s1.minimumByRule.installments_due);
    expect(minimumPayment({ rule: 'pct_balance', pct: 10, floorMinor: 0 }, cycle)).toBe(s1.minimumByRule.pct_balance_10);
  });

  it('applies the floor but never asks for more than the whole statement', () => {
    expect(minimumPayment({ rule: 'pct_balance', pct: 1, floorMinor: 100_000 }, cycle)).toBe(100_000);
    expect(minimumPayment({ rule: 'installments_due', floorMinor: 900_000 }, cycle)).toBe(621_102);
    expect(minimumPayment({ rule: 'pct_balance', pct: 5, floorMinor: 20_000 }, { ...cycle, payInFullMinor: 8_000 })).toBe(8_000);
  });
});

describe('minimum payment and past due', () => {
  it('shows the minimum of the statement, computed from the configured rule', () => {
    const projection = project(debt(), [], '2026-04-20');
    expect(row(projection, 1)).toMatchObject({ minimumMinor: s1.minimumMinor, totalDueMinor: s1.minimumMinor, outstandingMinor: s1.minimumMinor, status: 'due' });
    expect(projection.nextDue.period).toBe(1);
    expect(projection.card).toMatchObject({ minimumDueMinor: s1.minimumMinor, minimumPastDue: false });
    expect(projection.pastDueMinor).toBe(0);
  });

  it('is not past due when only the minimum is paid by the due date, and the remainder stays revolving', () => {
    const after = fixture.afterMinimum;
    const projection = project(debt(), [pay('2026-04-30', after.paymentMinor, 'min')], '2026-05-20');
    expect(row(projection, 1)).toMatchObject({ status: 'paid', paidMinor: s1.minimumMinor, outstandingMinor: 0, paidByEventIds: ['min'] });
    expect(projection.pastDueMinor).toBe(0);
    expect(tranche(projection, 'revolving').balanceMinor).toBe(after.revolvingMinor);
    expect(row(projection, 2)).toMatchObject({ interestMinor: after.interestMinor, statementTotalMinor: after.totalMinor, payInFullMinor: after.payInFullMinor, minimumMinor: after.minimumMinor });
  });

  it('flags the shortfall as past due when the payment is below the minimum', () => {
    const events = [pay('2026-04-28', s1.minimumMinor - 10_000, 'short')];
    const before = project(debt(), events, '2026-04-29');
    expect(row(before, 1)).toMatchObject({ status: 'partial', outstandingMinor: 10_000 });
    expect(before.pastDueMinor).toBe(0);
    const after = project(debt(), events, '2026-05-02');
    expect(row(after, 1)).toMatchObject({ status: 'pastDue', outstandingMinor: 10_000 });
    expect(after).toMatchObject({ pastDueMinor: 10_000 });
    expect(after.card.minimumPastDue).toBe(true);
    expect(after.nextDue.period).toBe(1);
  });

  it('counts a payment made on the due date, and a late one still reduces the shortfall', () => {
    expect(project(debt(), [pay('2026-04-30', s1.minimumMinor, 'on')], '2026-05-02').pastDueMinor).toBe(0);
    const late = [pay('2026-04-30', s1.minimumMinor - 10_000, 'a'), pay('2026-05-05', 4_000, 'b')];
    expect(project(debt(), late, '2026-05-06').pastDueMinor).toBe(6_000);
    expect(project(debt(), [...late, pay('2026-05-06', 6_000, 'c')], '2026-05-07').pastDueMinor).toBe(0);
  });

  it('measures past due against each closed cycle, oldest first', () => {
    const projection = project(debt(), [], '2026-06-01');
    const minimums = projection.plan.map((entry) => entry.minimumMinor);
    expect(projection.plan).toHaveLength(2);
    expect(projection.pastDueMinor).toBe(minimums[0] + minimums[1]);
    const partial = project(debt(), [pay('2026-05-31', minimums[0] + 1_000, 'p')], '2026-06-01');
    expect(row(partial, 1)).toMatchObject({ status: 'paid', paidMinor: minimums[0] });
    expect(row(partial, 2)).toMatchObject({ status: 'pastDue', paidMinor: 1_000 });
    expect(partial.pastDueMinor).toBe(minimums[1] - 1_000);
  });

  it('uses the minimum stated on the statement instead of the computed one', () => {
    const events = [adjust('2026-04-15', { minimumDueMinor: 150_000 }, 'stmt'), pay('2026-04-30', s1.minimumMinor, 'p')];
    const projection = project(debt(), events, '2026-05-02');
    expect(row(projection, 1)).toMatchObject({ minimumMinor: 150_000, outstandingMinor: 150_000 - s1.minimumMinor, status: 'pastDue' });
    expect(projection.pastDueMinor).toBe(150_000 - s1.minimumMinor);
  });

  it('pays the minimum every cycle without ever being past due, and a short payment leaves exactly the shortfall (seeded, 60 cards)', () => {
    const next = mulberry32(77);
    let short = 0;
    for (let seed = 0; seed < 60; seed += 1) {
      const statementDay = 1 + Math.floor(next() * 14);
      const dueDay = 15 + Math.floor(next() * 14);
      const rules = ['pct_balance', 'interest_fees_plus_pct', 'installments_due'];
      const minPayment = { rule: rules[seed % 3], pct: 3 + Math.floor(next() * 12), floorMinor: Math.round(next() * 50_000) };
      const card = terms({ principalMinor: Math.round(next() * 3_000_000), rate: EA(5 + next() * 40) }, { statementDay, dueDay, minPayment });
      const events = [];
      let expected = 0;
      for (let k = 0; k < 5; k += 1) {
        const { statementOn, dueOn } = cycleDates(statementDay, dueDay, `2026-${String(4 + k).padStart(2, '0')}`);
        const minimum = row(project(debt(card), events, statementOn), k + 1).minimumMinor;
        const shortfall = seed % 2 === 0 ? 0 : Math.min(minimum, Math.round(next() * 20_000));
        events.push(pay(dueOn, minimum - shortfall, `s${seed}p${k}`));
        expected += shortfall;
        short += shortfall > 0 ? 1 : 0;
      }
      const projection = project(debt(card), events, '2026-08-31');
      expect(projection.pastDueMinor).toBe(expected);
      expect(projection.nextDue === null || projection.nextDue.status === 'pastDue').toBe(true);
    }
    expect(short).toBeGreaterThan(50);
  });
});

describe('statement-driven balance', () => {
  const simple = () => terms({ principalMinor: 1_000_000, charges: [] }, { deferred: [] });

  it('reconciles the projection to the balance stated on the statement and records the drift', () => {
    const events = [adjust('2026-04-02', { balanceMinor: 1_000_350 }, 'adj')];
    const projection = project(debt(simple()), events, '2026-04-02');
    expect(project(debt(simple()), [], '2026-04-02').balanceMinor).toBe(1_000_000);
    expect(projection.balanceMinor).toBe(1_000_350);
    expect(projection.applied[0]).toMatchObject({ kind: 'adjustment', driftMinor: 350, absorbed: true });
    expect(projection.notices).toEqual([{ code: 'drift', eventId: 'adj', amountMinor: 350, absorbed: true }]);
    const lower = project(debt(simple()), [adjust('2026-04-02', { balanceMinor: 940_000 }, 'low')], '2026-04-02');
    expect(lower.balanceMinor).toBe(940_000);
    expect(lower.applied[0].driftMinor).toBe(-60_000);
  });

  it('applies a statement dated on its cut-off day after the statement is billed', () => {
    const stated = 1_700_000 + s1.interestMinor + s1.chargesMinor + s1.taxesMinor + 500;
    const projection = project(debt(), [adjust('2026-04-15', { balanceMinor: stated, minimumDueMinor: 140_000 }, 'stmt')], '2026-04-16');
    expect(projection.balanceMinor).toBe(stated);
    expect(row(projection, 1)).toMatchObject({ interestMinor: s1.interestMinor, minimumMinor: 140_000 });
  });

  it('resets a deferred tranche to the stated balance and rebuilds its remaining installments', () => {
    const events = [adjust('2026-04-16', { trancheBalances: { nevera: 1_000_000 } }, 'adj')];
    const projection = project(debt(), events, '2026-05-20');
    expect(tranche(projection, 'nevera')).toMatchObject({ balanceMinor: 1_000_000, installmentsLeft: 10 });
    expect(row(projection, 2).principalMinor).toBe(Math.round(900_000 / 11));
  });

  it('reports a drift it cannot absorb', () => {
    const projection = project(debt(), [adjust('2026-04-10', { balanceMinor: 50_000 }, 'tiny')], '2026-04-10');
    expect(tranche(projection, 'revolving').balanceMinor).toBe(0);
    expect(projection.notices[0]).toMatchObject({ code: 'drift', absorbed: false });
    expect(projection.balanceMinor).toBe(1_200_000);
  });
});
