// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/errors.js';
import { planCommit } from '../../src/ledger/commit.js';
import { previewChange } from '../../src/ledger/preview.js';
import { project } from '../../src/ledger/project.js';
import { dailyRate } from '../../src/late/policy.js';
import { resolveLegal } from '../../src/legal.js';

// Card mora (F3). Golden: the fixture card's first minimum is 146,102, of which 21,102 is interest, fees and taxes,
// so 125,000 of capital stays unmet when nothing is paid. With the usury cap at 28.59% EA, 10 days of mora on
// 125,000 are 861 (exact 861.46).
const fixture = JSON.parse(readFileSync(new URL('../fixtures/card-statement-independent.json', import.meta.url), 'utf8'));

const cap = (capEA) => ({ modality: 'consumer', validFrom: '2026-01-01', validTo: '2026-12-31', capEA, source: 'test', verified: true });
const LEGAL = resolveLegal([], { usuryTable: [cap(28.59)] });
const USURY = { mode: 'usury', graceDays: 0 };
const DAILY = dailyRate(28.59);

// Statement on the 20th, due on the 10th of the next month: the second statement closes 10 days after the first due date.
const terms = (overrides = {}, card = {}) => ({ ...fixture.terms, ...overrides, card: { ...fixture.terms.card, statementDay: 20, dueDay: 10, ...card } });
const debt = (t = terms({ late: USURY })) => ({ $id: 'card1', householdId: 'h1', name: 'Visa', ownerScope: 'shared', terms: t, legal: LEGAL });
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
const row = (projection, period) => projection.plan.find((entry) => entry.period === period);
const tranche = (projection, id) => projection.tranches.find((entry) => entry.id === id);
const exact = (base, days) => base * DAILY * days;

describe('card mora: the unmet capital of the minimum payment', () => {
  it('accrues 861 on 125,000 for the 10 days between the due date and the next close, and bills it there', () => {
    const { minimumMinor, interestMinor, chargesMinor, taxesMinor } = fixture.statement1;
    expect(minimumMinor - (interestMinor + chargesMinor + taxesMinor)).toBe(125_000);
    const projection = project(debt(), [], '2026-05-20');
    expect(row(projection, 1)).toMatchObject({ dueOn: '2026-05-10', minimumMinor: 146_102, lateMinor: 861, lateDays: 10, lateBaseMinor: 125_000 });
    expect(row(projection, 2)).toMatchObject({ statementOn: '2026-05-20', lateInterestMinor: 861 });
    expect(exact(125_000, 10)).toBeCloseTo(861.46, 2);
    expect(projection.lateInterestMinor).toBe(861);
    expect(projection.totals.remainingLateInterest).toBe(861);
  });

  it('puts the billed mora in the statement total, the minimum and the balance, apart from the revolving balance', () => {
    const withMora = project(debt(), [], '2026-05-20');
    const without = project(debt(terms({ late: { mode: 'none', graceDays: 0 } })), [], '2026-05-20');
    expect(row(withMora, 2).statementTotalMinor - row(without, 2).statementTotalMinor).toBe(861 - (row(without, 2).interestMinor - row(withMora, 2).interestMinor));
    expect(withMora.card.payInFullMinor - without.card.payInFullMinor).toBe(861 - (row(without, 2).interestMinor - row(withMora, 2).interestMinor));
    expect(tranche(withMora, 'revolving').balanceMinor).toBe(tranche(without, 'revolving').balanceMinor);
  });

  it('shows the mora accrued so far before it is billed, without moving the balance', () => {
    const mid = project(debt(), [], '2026-05-15');
    const none = project(debt(terms({ late: { mode: 'none', graceDays: 0 } })), [], '2026-05-15');
    expect(row(mid, 1).lateMinor).toBe(Math.round(exact(125_000, 5)));
    expect(mid.lateInterestMinor).toBe(431);
    expect(mid.totals.remainingLateInterest).toBe(431);
    expect(mid.balanceMinor).toBe(none.balanceMinor);
    expect(project(debt(), [], '2026-05-10').lateInterestMinor).toBe(0);
  });

  it('stops at the next close: later days add nothing to the first cycle and the billed line is not re-billed', () => {
    const later = project(debt(), [], '2026-05-31');
    expect(row(later, 1)).toMatchObject({ lateMinor: 861, lateDays: 10 });
    expect(row(later, 2).lateInterestMinor).toBe(861);
    expect(later.lateInterestMinor).toBe(861);
  });

  it('stops when a payment covers the shortfall and bills what accrued up to that day at the next close', () => {
    const covered = project(debt(), [pay('2026-05-15', 146_102, 'cover')], '2026-05-20');
    expect(row(covered, 1)).toMatchObject({ lateDays: 5, lateMinor: Math.round(exact(125_000, 5)), status: 'paid' });
    expect(row(covered, 2).lateInterestMinor).toBe(431);
    // A partial payment of the capital lowers the base from that day on.
    const partial = project(debt(), [pay('2026-05-15', 71_102, 'part')], '2026-05-20');
    expect(row(partial, 1).lateMinor).toBe(Math.round(exact(125_000, 5) + exact(75_000, 5)));
  });

  it('accrues nothing when the minimum is paid by the due date, and the debt is not past due', () => {
    const projection = project(debt(), [pay('2026-05-10', 146_102, 'min')], '2026-05-20');
    expect(row(projection, 1)).toMatchObject({ status: 'paid', lateMinor: 0, lateDays: 0 });
    expect(projection.lateInterestMinor).toBe(0);
    expect(projection.pastDueMinor).toBe(0);
  });

  it('accrues nothing with mode none, but the shortfall is still flagged past due', () => {
    for (const late of [{ mode: 'none', graceDays: 0 }, undefined]) {
      const projection = project(debt(terms({ late })), [], '2026-05-20');
      expect(projection.lateInterestMinor).toBe(0);
      expect(row(projection, 2).lateInterestMinor).toBe(0);
      expect(projection.pastDueMinor).toBe(146_102);
      expect(projection.card.minimumPastDue).toBe(true);
    }
  });

  it('replaces the revolving interest on the unmet capital for the days the mora runs', () => {
    const withMora = project(debt(), [], '2026-05-20');
    const without = project(debt(terms({ late: { mode: 'none', graceDays: 0 } })), [], '2026-05-20');
    const monthly = 1.28 ** (1 / 12) - 1;
    expect(row(without, 2).interestMinor).toBe(10_392);
    expect(row(withMora, 2).interestMinor).toBe(Math.round((500_000 - (125_000 * 10) / 30) * monthly));
    expect(row(withMora, 2).interestMinor).toBeLessThan(row(without, 2).interestMinor);
  });

  it('honours the grace days and the policy change dates', () => {
    const grace = project(debt(terms({ late: { mode: 'usury', graceDays: 3 } })), [], '2026-05-20');
    expect(row(grace, 1)).toMatchObject({ lateDays: 7, lateMinor: Math.round(exact(125_000, 7)) });
    const switched = project(debt(terms({ late: { mode: 'none', graceDays: 0 } })), [ev('late_policy', '2026-05-15', 0, { late: USURY })], '2026-05-20');
    expect(row(switched, 1)).toMatchObject({ lateDays: 5, lateMinor: 431 });
    const early = project(debt(terms({ late: { mode: 'none', graceDays: 0 } })), [ev('late_policy', '2026-05-01', 0, { late: USURY })], '2026-05-20');
    expect(row(early, 1).lateMinor).toBe(861);
  });

  it('uses the contract rate and flags the unknown cap when no cap covers the days', () => {
    const noCap = { ...debt(), legal: resolveLegal([], { usuryTable: [] }) };
    const projection = project(noCap, [], '2026-05-20');
    expect(row(projection, 1).lateMinor).toBe(Math.round(125_000 * dailyRate(28) * 10));
    expect(projection.notices.map((notice) => notice.code)).toContain('late_cap_unknown');
  });

  it('lets a payment settle the billed mora first, as a cost of the payment', () => {
    const projection = project(debt(), [pay('2026-05-21', 100_000, 'p')], '2026-05-21');
    expect(projection.applied[0].allocation.lateInterest).toBe(861);
    expect(projection.applied[0].costMinor).toBeGreaterThanOrEqual(861);
    expect(projection.totals.lateInterestPaid).toBe(861);
    expect(projection.totals.remainingLateInterest).toBe(0);
  });
});

describe('card mora: statement override', () => {
  it('replaces the computed mora with the statement value and reports the drift', () => {
    const projection = project(debt(), [ev('adjustment', '2026-05-20', 0, { lateInterestMinor: 900 }, 'adj')], '2026-05-20');
    expect(row(projection, 2).lateInterestMinor).toBe(900);
    expect(projection.lateInterestMinor).toBe(900);
    expect(projection.applied[0].driftMinor).toBe(39);
    expect(projection.notices).toContainEqual(expect.objectContaining({ code: 'drift', amountMinor: 39 }));
    const base = project(debt(), [], '2026-05-20');
    expect(projection.balanceMinor - base.balanceMinor).toBe(39);
    expect(tranche(projection, 'revolving').balanceMinor).toBe(tranche(base, 'revolving').balanceMinor);
  });

  it('keeps the override when a larger statement balance is given together with it', () => {
    const base = project(debt(), [], '2026-05-20');
    const stated = base.balanceMinor + 39;
    const projection = project(debt(), [ev('adjustment', '2026-05-20', 0, { lateInterestMinor: 900, balanceMinor: stated }, 'adj')], '2026-05-20');
    expect(projection.balanceMinor).toBe(stated);
    expect(projection.lateInterestMinor).toBe(900);
    expect(tranche(projection, 'revolving').balanceMinor).toBe(tranche(base, 'revolving').balanceMinor);
  });

  it('rejects a negative or fractional statement mora', () => {
    expect(() => project(debt(), [ev('adjustment', '2026-05-20', 0, { lateInterestMinor: -1 })], '2026-05-20')).toThrow(ValidationError);
    expect(() => project(debt(), [ev('adjustment', '2026-05-20', 0, { lateInterestMinor: 1.5 })], '2026-05-20')).toThrow(ValidationError);
  });
});

describe('card plan changes: restructure is not supported', () => {
  const ctx = { eventId: 'r1', dedupeKey: 'web:r1', actorId: 'u1', source: 'web' };
  const draft = { kind: 'restructure', effectiveOn: '2026-05-01', terms: terms() };

  it('throws restructure_unsupported from planCommit and previewChange, before anything is built', () => {
    for (const attempt of [() => planCommit(debt(), [], draft, ctx), () => previewChange(debt(), [], draft, { on: '2026-05-01' })]) {
      expect(attempt).toThrow(ValidationError);
      expect(attempt).toThrow(expect.objectContaining({ code: 'restructure_unsupported' }));
    }
  });

  it('skips a stored card restructure with a notice and leaves the projection untouched', () => {
    const stored = ev('restructure', '2026-04-25', 0, { terms: terms() }, 'rs');
    const withEvent = project(debt(), [stored], '2026-05-20');
    const base = project(debt(), [], '2026-05-20');
    expect(withEvent.balanceMinor).toBe(base.balanceMinor);
    expect(withEvent.notices).toContainEqual({ code: 'card_restructure_ignored', eventId: 'rs' });
    expect(base.notices.some((notice) => notice.code === 'card_restructure_ignored')).toBe(false);
  });

  it('still plans and previews the other plan changes on a card, including late_policy', () => {
    const late = { kind: 'late_policy', effectiveOn: '2026-05-01', late: USURY };
    const plan = planCommit(debt(terms({ late: { mode: 'none', graceDays: 0 } })), [], late, { ...ctx, asOf: '2026-05-20' });
    expect(plan.projection.lateInterestMinor).toBe(861);
    const preview = previewChange(debt(terms({ late: { mode: 'none', graceDays: 0 } })), [], late, { on: '2026-05-20' });
    expect(preview.before.lateInterestMinor).toBe(0);
    expect(preview.after.lateInterestMinor).toBe(861);
    expect(preview.after.remainingCostMinor).toBe(preview.after.remainingInterestMinor + preview.after.remainingChargesMinor + 861);
  });
});
