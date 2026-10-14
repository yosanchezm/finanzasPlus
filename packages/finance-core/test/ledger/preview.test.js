// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { periodDates } from '../../src/calendar.js';
import { removeCharge } from '../../src/charges.js';
import { ValidationError } from '../../src/errors.js';
import { planCommit } from '../../src/ledger/commit.js';
import { previewChange } from '../../src/ledger/preview.js';
import { project } from '../../src/ledger/project.js';
import { snapshot } from '../../src/ledger/snapshot.js';
import { roundUnit } from '../../src/money.js';
import { periodicRate, toEffectiveAnnual } from '../../src/rates.js';
import { levelPayment } from '../../src/schedule/french.js';
import { buildSchedule } from '../../src/schedule/index.js';
import { validateTerms } from '../../src/terms.js';
import { EA, debt, deepFreeze, ev, french, onTime } from '../helpers/loans.js';

// DL2 (plan change preview) and the pieces it rests on: a shared snapshot, the
// EA echo of applyRateChange, removeCharge and the card characterization (CC2).

const codeOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.code;
  }
  return 'did not throw';
};

const paid = onTime(french(), 3); // installments due 2026-02-15, 03-15 and 04-15, paid on time
const rateDraft = (overrides = {}) => ({ kind: 'rate_change', effectiveOn: '2026-05-01', rate: EA(18), mode: 'keep_term', ...overrides });
const ctx = { eventId: 'saved1', dedupeKey: 'web:n1', actorId: 'u1', source: 'web' };

describe('snapshot', () => {
  it('summarizes a projection as of a date: next open installment, remaining periods and remaining cost', () => {
    const projection = project(debt(french()), paid, '2026-05-02');
    expect(snapshot(projection, '2026-05-02')).toEqual({
      balanceMinor: projection.balanceMinor,
      pastDueMinor: 0,
      lateInterestMinor: 0,
      installmentMinor: 380_381,
      nextTotalMinor: 380_381,
      nextDueOn: '2026-05-15',
      remainingPeriods: 33,
      lastDueOn: '2029-01-15',
      remainingInterestMinor: projection.totals.remainingInterest,
      remainingChargesMinor: 0,
      remainingCostMinor: projection.totals.remainingInterest,
    });
  });

  it('counts charges and taxes in the remaining cost and reports zeros for a paid-off debt', () => {
    const insured = french({ charges: [{ id: 'fee', kind: 'fee', label: 'Fee', basis: 'fixed', value: 10_000 }] });
    const open = snapshot(project(debt(insured), onTime(insured, 3), '2026-05-02'), '2026-05-02');
    expect(open.remainingChargesMinor).toBe(330_000);
    expect(open.remainingCostMinor).toBe(open.remainingInterestMinor + 330_000);
    expect(open.nextTotalMinor).toBe(open.installmentMinor + 10_000); // the installment plus its fee
    const done = snapshot(project(debt(french()), onTime(french(), 36), '2029-02-01'), '2029-02-01');
    expect(done).toMatchObject({ balanceMinor: 0, installmentMinor: 0, nextDueOn: null, lastDueOn: null, remainingPeriods: 0, nextTotalMinor: 0, remainingCostMinor: 0 });
  });
});

describe('applyRateChange reports the EA before and after', () => {
  it('adds fromEA and toEA to the applied entry, chaining from the previous change', () => {
    const events = [...paid, ev('rate_change', '2026-05-01', 0, { rate: EA(18), mode: 'keep_term' }, 'r1'), ev('rate_change', '2026-06-01', 0, { rate: EA(20), mode: 'keep_term' }, 'r2')];
    const applied = project(debt(french()), events, '2026-06-02').applied.filter((entry) => entry.kind === 'rate_change');
    expect(applied).toHaveLength(2);
    expect(applied[0].fromEA).toBeCloseTo(24, 6);
    expect(applied[0].toEA).toBeCloseTo(18, 6);
    expect(applied[1].fromEA).toBeCloseTo(18, 6);
    expect(applied[1].toEA).toBeCloseTo(20, 6);
  });

  it('converts a nominal monthly rate to its EA', () => {
    const monthly = { convention: 'MV', value: 2 };
    const applied = project(debt(french()), [ev('rate_change', '2026-05-01', 0, { rate: monthly, mode: 'keep_term' }, 'r1')], '2026-05-02').applied[0];
    expect(applied.toEA).toBeCloseTo(26.82, 2);
  });
});

describe('applyRestructure reports the carried balance', () => {
  it('adds carriedMinor: the balance plus what the refinanced rows still owed', () => {
    const terms = french({ openedOn: '2026-05-01', principalMinor: 5_000_000, n: 24, firstDueOn: '2026-06-15' });
    const events = [...paid, ev('restructure', '2026-05-01', 0, { terms }, 'rs1')];
    const projection = project(debt(french()), events, '2026-05-02');
    const entry = projection.applied.find((applied) => applied.kind === 'restructure');
    expect(entry.carriedMinor).toBe(buildSchedule(french())[2].closingMinor);
    expect(projection.balanceMinor).toBe(entry.carriedMinor);
  });
});

describe('previewChange: rate_change', () => {
  const on = '2026-05-01';
  const base = project(debt(french()), paid, on);

  it('returns before and after snapshots that match the projection with and without the candidate', () => {
    const result = previewChange(debt(french()), paid, rateDraft(), { on });
    expect(result.before).toEqual(snapshot(base, on));
    expect(result.before).toMatchObject({ installmentMinor: 380_381, remainingPeriods: 33, nextDueOn: '2026-05-15' });
    const expected = roundUnit(levelPayment(base.balanceMinor, periodicRate(EA(18), 'monthly'), 33), 1);
    expect(result.after).toMatchObject({ installmentMinor: expected, remainingPeriods: 33, nextDueOn: '2026-05-15', lastDueOn: '2029-01-15' });
    expect(result.after.installmentMinor).toBeLessThan(380_381);
    expect(result.after.remainingCostMinor).toBeLessThan(result.before.remainingCostMinor);
    expect(result).toMatchObject({ backdated: false, impacted: [], notices: [] });
    expect(previewChange(debt(french()), paid, rateDraft(), { on: '2026-05-02' })).toMatchObject({ backdated: true, impacted: [] });
  });

  it('equals the projection obtained after the event is saved (keep_term)', () => {
    const draft = rateDraft();
    const preview = previewChange(debt(french()), paid, draft, { on });
    const plan = planCommit(debt(french()), paid, draft, { ...ctx, asOf: on });
    const stored = { $id: 'saved1', debtId: 'd1', kind: 'rate_change', effectiveOn: '2026-05-01', amountMinor: 0, payloadJson: plan.event.data.payloadJson, $createdAt: '2026-05-02T09:00:00.000Z' };
    const after = snapshot(project(debt(french()), [...paid, stored], on), on);
    expect(preview.after).toEqual(after);
    expect(preview.after).toEqual(snapshot(plan.projection, on));
  });

  it('keep_installment holds the installment and shortens the term; keep_term holds the term and lowers the installment', () => {
    const keepInstallment = previewChange(debt(french()), paid, rateDraft({ mode: 'keep_installment' }), { on });
    const keepTerm = previewChange(debt(french()), paid, rateDraft({ mode: 'keep_term' }), { on });
    expect(keepInstallment.after.installmentMinor).toBe(380_381);
    expect(keepInstallment.after.remainingPeriods).toBeLessThan(33);
    expect(keepTerm.after.remainingPeriods).toBe(33);
    expect(keepTerm.after.installmentMinor).toBeLessThan(380_381);
    const higher = previewChange(debt(french()), paid, rateDraft({ rate: EA(30), mode: 'keep_installment' }), { on });
    expect(higher.after.remainingPeriods).toBeGreaterThan(33);
    expect(higher.after.installmentMinor).toBe(380_381);
  });

  it('throws a ValidationError with code installment_too_low when keep_installment cannot cover the new interest', () => {
    const draft = rateDraft({ rate: EA(200), mode: 'keep_installment' });
    expect(() => previewChange(debt(french()), paid, draft, { on })).toThrow(ValidationError);
    expect(codeOf(() => previewChange(debt(french()), paid, draft, { on }))).toBe('installment_too_low');
    const fallback = previewChange(debt(french()), paid, { ...draft, mode: 'keep_term' }, { on });
    expect(fallback.after.remainingPeriods).toBe(33);
    expect(fallback.after.installmentMinor).toBeGreaterThan(380_381);
  });

  it('measures at the effective date when it is later than the reference date', () => {
    const future = previewChange(debt(french()), paid, rateDraft({ effectiveOn: '2026-07-01' }), { on });
    expect(future.backdated).toBe(false);
    expect(future.before.nextDueOn).toBe('2026-07-15');
    expect(future.after.nextDueOn).toBe('2026-07-15');
    expect(future.after.installmentMinor).toBeLessThan(future.before.installmentMinor);
  });
});

describe('previewChange: impacted payments (backdated change)', () => {
  const late = ev('payment', '2026-08-05', 380_381, {}, 'late');
  const five = onTime(french(), 5);
  const events = [...five, late];
  const schedule = buildSchedule(french());

  it('lists the payment recorded after a change dated before it, with its cost before and after', () => {
    const result = previewChange(debt(french()), events, rateDraft({ effectiveOn: '2026-07-01' }), { on: '2026-08-20' });
    expect(result.backdated).toBe(true);
    // Rows 6 and 7 rebuilt at 18% EA from the balance after the fifth installment; the old installment now overpays row 6.
    const [sixth, seventh] = buildSchedule(french({ rate: EA(18) }), { fromPeriod: 6, balanceMinor: schedule[4].closingMinor });
    const costAfterMinor = sixth.interestMinor + Math.min(380_381 - sixth.totalDueMinor, seventh.interestMinor);
    expect(result.impacted).toEqual([
      { eventId: 'late', kind: 'payment', effectiveOn: '2026-08-05', costBeforeMinor: schedule[5].interestMinor, costAfterMinor },
    ]);
    expect(costAfterMinor).toBeLessThan(schedule[5].interestMinor);
  });

  it('does not list payments whose cost stays the same, nor anything for a change dated after them', () => {
    const afterAll = previewChange(debt(french()), events, rateDraft({ effectiveOn: '2026-09-01' }), { on: '2026-08-20' });
    expect(afterAll.backdated).toBe(false);
    expect(afterAll.impacted).toEqual([]);
    const sameDay = previewChange(debt(french()), five, rateDraft({ effectiveOn: '2026-07-01' }), { on: '2026-08-20' });
    expect(sameDay.backdated).toBe(true);
    expect(sameDay.impacted).toEqual([]);
  });
});

describe('previewChange: charge_change, restructure and payloadChars', () => {
  it('previews a charge_change: a fixed fee on every remaining installment adds exactly that to the remaining cost', () => {
    const charges = [{ id: 'fee', kind: 'fee', label: 'Fee', basis: 'fixed', value: 10_000 }];
    const result = previewChange(debt(french()), paid, { kind: 'charge_change', effectiveOn: '2026-05-01', charges }, { on: '2026-05-02' });
    expect(result.after.remainingCostMinor - result.before.remainingCostMinor).toBe(330_000);
    expect(result.after.remainingPeriods).toBe(result.before.remainingPeriods);
    expect(result.after.installmentMinor).toBe(result.before.installmentMinor);
    expect(result.after.nextTotalMinor - result.before.nextTotalMinor).toBe(10_000);
  });

  it('previews a restructure on the carried balance and the new number of periods', () => {
    const terms = french({ openedOn: '2026-05-01', principalMinor: 9_000_000, n: 24, firstDueOn: '2026-06-15' });
    const result = previewChange(debt(french()), paid, { kind: 'restructure', effectiveOn: '2026-05-01', terms }, { on: '2026-05-02' });
    expect(result.before.remainingPeriods).toBe(33);
    expect(result.after).toMatchObject({ remainingPeriods: 24, nextDueOn: '2026-06-15', lastDueOn: '2028-05-15' });
    expect(result.after.balanceMinor).toBe(result.before.balanceMinor);
  });

  it('reports payloadChars as the serialized payload length, also when it is over the 8000 limit', () => {
    const small = previewChange(debt(french()), paid, rateDraft(), { on: '2026-05-02' });
    const plan = planCommit(debt(french()), paid, rateDraft(), ctx);
    expect(small.payloadChars).toBe(plan.event.data.payloadJson.length);
    const dates = periodDates('2026-06-15', 'monthly', 450);
    const manual = { ...french({ openedOn: '2026-05-01', n: 450, firstDueOn: '2026-06-15', system: 'manual' }), manualPlan: dates.map((date) => [date, 250_000]) };
    const big = previewChange(debt(french()), paid, { kind: 'restructure', effectiveOn: '2026-05-01', terms: manual }, { on: '2026-05-02' });
    expect(big.payloadChars).toBe(JSON.stringify({ terms: validateTerms(manual) }).length);
    expect(big.payloadChars).toBeGreaterThan(8000);
    expect(codeOf(() => planCommit(debt(french()), paid, { kind: 'restructure', effectiveOn: '2026-05-01', terms: manual }, ctx))).toBe('payload_too_large');
  });
});

describe('previewChange: guards and purity', () => {
  it('forwards the notices of the projection with the candidate', () => {
    const future = { $id: 'x1', debtId: 'd1', kind: 'late_policy_from_the_future', effectiveOn: '2026-04-01', amountMinor: 0, payloadJson: '{}', $createdAt: '2026-04-01T00:00:00.000Z' };
    const result = previewChange(debt(french()), [...paid, future], rateDraft(), { on: '2026-05-02' });
    expect(result.notices).toEqual([{ code: 'unknown_event_kind', eventId: 'x1', kind: 'late_policy_from_the_future' }]);
  });

  it('refuses drafts that are not plan changes, invalid payloads and a bad reference date', () => {
    expect(codeOf(() => previewChange(debt(french()), paid, { kind: 'payment', effectiveOn: '2026-05-01', amountMinor: 1_000 }, { on: '2026-05-02' }))).toBe('invalid_draft');
    expect(codeOf(() => previewChange(debt(french()), paid, { kind: 'void', effectiveOn: '2026-05-01', targetEventId: 'on1' }, { on: '2026-05-02' }))).toBe('invalid_draft');
    expect(codeOf(() => previewChange(debt(french()), paid, undefined, { on: '2026-05-02' }))).toBe('invalid_draft');
    expect(codeOf(() => previewChange(debt(french()), paid, rateDraft({ mode: 'later' }), { on: '2026-05-02' }))).toBe('invalid_event');
    expect(codeOf(() => previewChange(debt(french()), paid, rateDraft({ effectiveOn: '2026-02-31' }), { on: '2026-05-02' }))).toBe('invalid_date');
    expect(codeOf(() => previewChange(debt(french()), paid, rateDraft(), { on: 'today' }))).toBe('invalid_date');
    expect(codeOf(() => previewChange(debt(french()), paid, rateDraft(), undefined))).toBe('invalid_date');
  });

  it('does not mutate its inputs', () => {
    const frozenDebt = deepFreeze(debt(french()));
    const frozenEvents = deepFreeze(onTime(french(), 3));
    const draft = deepFreeze(rateDraft());
    const first = previewChange(frozenDebt, frozenEvents, draft, { on: '2026-05-02' });
    expect(previewChange(frozenDebt, frozenEvents, draft, { on: '2026-05-02' })).toEqual(first);
  });
});

describe('removeCharge', () => {
  const fee = { id: 'fee', kind: 'fee', label: 'Fee', basis: 'fixed', value: 10_000 };
  const iva = { id: 'iva', kind: 'tax', label: 'IVA', basis: 'pctOfCharge', refId: 'fee', value: 19 };
  const surcharge = { id: 'sur', kind: 'tax', label: 'Surcharge', basis: 'pctOfCharge', refId: 'iva', value: 1 };
  const life = { id: 'life', kind: 'insurance', label: 'Life', basis: 'pctOutstanding', value: 0.05 };
  const gmf = { id: 'gmf', kind: 'tax', label: 'GMF', basis: 'pctOfSubtotal', value: 0.4 };

  it('removes the charge and every charge that references it, transitively', () => {
    expect(removeCharge([fee, iva, surcharge, life, gmf], 'fee')).toEqual([life, gmf]);
    expect(removeCharge([fee, iva, surcharge, life, gmf], 'iva')).toEqual([fee, life, gmf]);
  });

  it('keeps unrelated charges, ignores an unknown id and returns a new array', () => {
    const charges = deepFreeze([fee, iva, life]);
    expect(removeCharge(charges, 'life')).toEqual([fee, iva]);
    const same = removeCharge(charges, 'nope');
    expect(same).toEqual([fee, iva, life]);
    expect(same).not.toBe(charges);
    expect(removeCharge([gmf, life], 'life')).toEqual([gmf]);
  });
});

describe('previewChange on a card (CC2 characterization)', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/card-statement-independent.json', import.meta.url), 'utf8'));
  const card = { $id: 'card1', householdId: 'h1', name: 'Visa', ownerScope: 'shared', terms: fixture.terms };
  const draft = { kind: 'rate_change', effectiveOn: '2026-05-01', rate: EA(35), mode: 'keep_term' };
  const stored = { $id: 'rc1', debtId: 'card1', kind: 'rate_change', effectiveOn: '2026-05-01', amountMinor: 0, payloadJson: JSON.stringify({ rate: EA(35), mode: 'keep_term' }), $createdAt: '2026-05-01T09:00:00.000Z' };

  it('does not throw, and the extra cost comes from the revolving balance only', () => {
    const result = previewChange(card, [], draft, { on: '2026-05-20' });
    expect(result.before.remainingPeriods).toBe(10);
    expect(result.after.remainingPeriods).toBe(10);
    expect(result.after.remainingCostMinor).toBeGreaterThan(result.before.remainingCostMinor);
    expect(result.after).toEqual(snapshot(project(card, [stored], '2026-05-20'), '2026-05-20'));
  });

  it('reports the minimum payment of the open statement as the next total, fees included', () => {
    const projection = project(card, [], '2026-04-20');
    const open = projection.plan[0];
    expect(snapshot(projection, '2026-04-20').nextTotalMinor).toBe(146_102);
    expect(open.minimumMinor).toBe(146_102);
    expect(snapshot(projection, '2026-04-20').installmentMinor).toBeLessThan(146_102); // interest and deferred only
  });

  it('changes the revolving rate while the 0% deferred tranche is untouched', () => {
    const tranches = (events) => project(card, events, '2026-05-20').tranches;
    const [revolvingBefore, nevera] = tranches([]);
    const [revolvingAfter, neveraAfter] = tranches([stored]);
    expect(revolvingBefore.rate).toEqual(fixture.terms.rate);
    expect(revolvingAfter.rate).toEqual(EA(35));
    expect(neveraAfter).toEqual(nevera);
    expect(toEffectiveAnnual(neveraAfter.rate)).toBe(0);
  });
});
