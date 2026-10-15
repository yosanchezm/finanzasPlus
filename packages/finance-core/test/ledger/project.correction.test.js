// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planCommit } from '../../src/ledger/commit.js';
import { project } from '../../src/ledger/project.js';
import { rateInForce } from '../../src/ledger/rateInForce.js';
import { validateTerms } from '../../src/terms.js';
import { mulberry32 } from '../helpers/prng.js';
import { EA, debt, ev, french } from '../helpers/loans.js';

// DL2, DL6 and CC2: a recorded correction applies as if the corrected values had held from the start of the
// terms version in force, whatever the event date; the latest non-voided one wins per field; voiding restores.

const fixture = JSON.parse(readFileSync(new URL('../fixtures/card-statement-independent.json', import.meta.url), 'utf8')).terms;
const cardTerms = validateTerms({ ...fixture, late: { mode: 'usury', graceDays: 0 } });
const NAMV = { value: 25.2, basis: 'nominal', periodicity: 'monthly', timing: 'arrears' };

const correction = (id, on, fields, previous, appliesTo = 'opening') => ev('terms_correction', on, 0, { fields, previous, appliesTo }, id);
const voidOf = (id, target, on = '2026-07-01') => ev('void', on, 0, { targetEventId: target }, id);
const withoutCorrections = ({ corrections, ...rest }) => rest;
const withoutNotices = ({ notices, ...rest }) => rest;

function shuffled(items, seed) {
  const random = mulberry32(seed);
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

describe('opening corrections on a loan', () => {
  const corrected = correction('c1', '2026-06-10', { rate: EA(20) }, { rate: EA(24) });

  it('replays as if the corrected rate held from the first installment, whatever the event date', () => {
    const reference = project(debt(french({ rate: EA(20) })), [], '2026-07-01');
    const projection = project(debt(french()), [corrected], '2026-07-01');
    expect(withoutCorrections(projection)).toEqual(reference);
    expect(projection.corrections).toEqual([{ eventId: 'c1', appliesTo: 'opening' }]);
    // the correction is dated 2026-06-10 and the projection date is earlier: it still applies
    expect(withoutCorrections(project(debt(french()), [corrected], '2026-03-01'))).toEqual(project(debt(french({ rate: EA(20) })), [], '2026-03-01'));
    expect(project(debt(french()), [corrected], '2026-07-01').plan[0].interestMinor).not.toBe(project(debt(french()), [], '2026-07-01').plan[0].interestMinor);
  });

  it('keeps a rate_change recorded before the correction: the rate in force is still 22 % EA', () => {
    const saved = french({ rate: EA(28.32) });
    const change = ev('rate_change', '2026-04-01', 0, { rate: EA(22), mode: 'keep_term' }, 'rc1');
    const fix = correction('c1', '2026-06-10', { rate: NAMV }, { rate: EA(28.32) });
    const projection = project(debt(saved), [change, fix], '2026-07-01');
    expect(rateInForce(projection)).toEqual(EA(22));
    const reference = project(debt(french({ rate: NAMV })), [change], '2026-07-01');
    expect(withoutCorrections(projection)).toEqual(reference);
    expect(projection.plan[0].interestMinor).toBe(reference.plan[0].interestMinor); // the installments before the change use the corrected rate
  });

  it('is independent of the storage order (seeded shuffles)', () => {
    const events = [
      ev('payment', '2026-02-15', 380_381, {}, 'p1'),
      correction('c1', '2026-05-01', { rate: EA(22) }, { rate: EA(24) }),
      correction('c2', '2026-06-01', { rate: EA(20), modality: 'productive' }, { rate: EA(22), modality: 'consumer' }),
      ev('rate_change', '2026-04-01', 0, { rate: EA(18), mode: 'keep_term' }, 'rc1'),
    ];
    const expected = project(debt(french()), events, '2026-07-01');
    for (let seed = 1; seed <= 30; seed += 1) expect(project(debt(french()), shuffled(events, seed), '2026-07-01')).toEqual(expected);
    expect(expected.terms.modality).toBe('productive');
    expect(expected.corrections.map((entry) => entry.eventId)).toEqual(['c1', 'c2']);
  });

  it('lets the latest correction win per field and keeps the earlier one on the fields it does not touch', () => {
    const first = correction('c1', '2026-05-01', { rate: EA(22), modality: 'productive' }, { rate: EA(24), modality: 'consumer' });
    const second = correction('c2', '2026-06-01', { rate: EA(20) }, { rate: EA(22) });
    const projection = project(debt(french()), [first, second], '2026-07-01');
    expect(projection.terms.rate).toEqual(EA(20));
    expect(projection.terms.modality).toBe('productive');
  });

  it('after a void, equals the projection that never had the correction (no corrections field)', () => {
    const baseline = project(debt(french()), [], '2026-07-01');
    const projection = project(debt(french()), [corrected, voidOf('v1', 'c1')], '2026-07-01');
    expect(projection).toEqual(baseline);
    expect(projection).not.toHaveProperty('corrections');
    expect(baseline).not.toHaveProperty('corrections');
  });

  it('honours a void dated after the projection date, because the correction itself ignores that date', () => {
    const late = voidOf('v1', 'c1', '2026-09-01');
    expect(project(debt(french()), [corrected, late], '2026-03-01')).toEqual(project(debt(french()), [], '2026-03-01'));
  });
});

describe('corrections bound to a restructure', () => {
  const base = french();
  const terms = (rate) => validateTerms({ ...base, principalMinor: 8_000_000, openedOn: '2026-05-10', firstDueOn: '2026-06-15', n: 24, rate });
  const restructure = (rate) => ev('restructure', '2026-05-10', 0, { terms: terms(rate) }, 'r1');
  const bound = correction('c2', '2026-06-01', { rate: EA(21) }, { rate: EA(20) }, 'r1');

  it('folds into the restructure terms in applyRestructure', () => {
    const reference = project(debt(base), [restructure(EA(21))], '2026-07-20');
    const projection = project(debt(base), [restructure(EA(20)), bound], '2026-07-20');
    expect(withoutCorrections(projection)).toEqual(reference);
    expect(projection.corrections).toEqual([{ eventId: 'c2', appliesTo: 'r1' }]);
    expect(projection.terms.rate).toEqual(EA(21));
  });

  it('does not touch the installments before the restructure and ignores an opening correction after it', () => {
    const opening = correction('c1', '2026-06-02', { rate: EA(30) }, { rate: EA(24) });
    const projection = project(debt(base), [restructure(EA(20)), opening], '2026-07-20');
    const withoutIt = project(debt(base), [restructure(EA(20))], '2026-07-20');
    expect(projection.terms).toEqual(withoutIt.terms); // the restructure terms replace the opening ones
    expect(projection.terms.rate).toEqual(EA(20));
    expect(projection.plan[0].interestMinor).toBeGreaterThan(withoutIt.plan[0].interestMinor); // the rows already due keep the corrected opening rate
  });

  it('skips a correction whose restructure was voided, with a notice, and projects the voided state', () => {
    const baseline = project(debt(base), [], '2026-07-20');
    const projection = project(debt(base), [restructure(EA(20)), bound, voidOf('v1', 'r1', '2026-06-20')], '2026-07-20');
    expect(projection.notices).toEqual([{ code: 'terms_correction_skipped', eventId: 'c2', reason: 'restructure_voided' }]);
    expect(withoutNotices(projection)).toEqual(withoutNotices(baseline));
    expect(projection).not.toHaveProperty('corrections');
  });

  it('keeps each version apart: a correction bound to the restructure does not change the opening terms', () => {
    const projection = project(debt(base), [restructure(EA(20)), bound, voidOf('v2', 'c2', '2026-06-20')], '2026-07-20');
    expect(projection).toEqual(project(debt(base), [restructure(EA(20))], '2026-07-20'));
  });
});

describe('stored corrections that cannot be applied', () => {
  it('skips a correction of card fields on a loan with a notice and projects the loan untouched', () => {
    const baseline = project(debt(french()), [], '2026-07-01');
    const stored = correction('c1', '2026-06-10', { card: { statementDay: 20 } }, { card: { statementDay: 15 } });
    const projection = project(debt(french()), [stored], '2026-07-01');
    expect(projection.notices).toEqual([{ code: 'terms_correction_skipped', eventId: 'c1', reason: 'invalid' }]);
    expect(withoutNotices(projection)).toEqual(withoutNotices(baseline));
  });

  it('skips a correction carrying a field this bundle does not support (written by a newer build), without throwing', () => {
    const baseline = project(debt(french()), [], '2026-07-01');
    const stored = ev('terms_correction', '2026-06-10', 0, { fields: { prepaymentPenaltyPct: 3 }, previous: {}, appliesTo: 'opening' }, 'c1');
    const projection = project(debt(french()), [stored], '2026-07-01');
    expect(projection.notices).toEqual([{ code: 'terms_correction_skipped', eventId: 'c1', reason: 'correction_unsupported_field' }]);
    expect(withoutNotices(projection)).toEqual(withoutNotices(baseline));
  });
});

describe('card corrections (CC2)', () => {
  const card = () => debt(cardTerms);
  const statements = (projection) => projection.plan.map((row) => row.statementOn);
  const day = (id, on, statementDay, previous) => correction(id, on, { card: { statementDay } }, { card: { statementDay: previous } });

  it('shows in the projection planCommit returns for the new event', () => {
    const draft = { kind: 'terms_correction', effectiveOn: '2026-05-20', fields: { card: { statementDay: 20 } }, previous: { card: { statementDay: 15 } }, appliesTo: 'opening' };
    const plan = planCommit(card(), [], draft, { eventId: 'corr1', dedupeKey: 'web:c1', actorId: 'u1', source: 'web' });
    expect(plan.projection.card.statementDay).toBe(20);
    expect(plan.projection.corrections).toEqual([{ eventId: 'corr1', appliesTo: 'opening' }]);
  });

  it('re-cuts every statement of the version on the corrected day', () => {
    const projection = project(card(), [day('c1', '2026-05-20', 20, 15)], '2026-07-01');
    expect(statements(projection)).toEqual(['2026-04-20', '2026-05-20', '2026-06-20']);
    expect(statements(project(card(), [], '2026-07-01'))).toEqual(['2026-04-15', '2026-05-15', '2026-06-15']);
    expect(projection.card.statementDay).toBe(20);
    expect(projection.corrections).toEqual([{ eventId: 'c1', appliesTo: 'opening' }]);
  });

  it('clamps a corrected statement day at the end of short months', () => {
    expect(statements(project(card(), [day('c1', '2026-05-20', 31, 15)], '2026-07-01'))).toEqual(['2026-04-30', '2026-05-31', '2026-06-30']);
    const february = project(card(), [day('c1', '2026-05-20', 30, 15)], '2027-03-05');
    expect(statements(february)).toContain('2027-02-28');
    expect(statements(february)).toContain('2027-01-30');
  });

  it('applies the second correction of the day and restores the first when the second is voided', () => {
    const first = day('c1', '2026-05-01', 18, 15);
    const second = day('c2', '2026-06-01', 22, 18);
    const both = project(card(), [first, second], '2026-08-01');
    expect(both.card.statementDay).toBe(22);
    const restored = project(card(), [first, second, voidOf('v1', 'c2')], '2026-08-01');
    expect(restored).toEqual(project(card(), [first], '2026-08-01'));
    expect(restored.card.statementDay).toBe(18);
    expect(project(card(), [first, second, voidOf('v1', 'c2'), voidOf('v2', 'c1')], '2026-08-01')).toEqual(project(card(), [], '2026-08-01'));
  });

  it('is independent of the storage order', () => {
    const events = [ev('payment', '2026-04-30', 140_000, {}, 'p1'), day('c1', '2026-05-01', 18, 15), day('c2', '2026-06-01', 22, 18)];
    const expected = project(card(), events, '2026-08-01');
    for (let seed = 1; seed <= 20; seed += 1) expect(project(card(), shuffled(events, seed), '2026-08-01')).toEqual(expected);
  });

  it('recomputes the minimums, the past-due flags and the mora under a corrected minimum percentage', () => {
    const payment = ev('payment', '2026-04-30', 140_000, {}, 'p1');
    const lower = correction('c1', '2026-06-01', { card: { minPayment: { pct: 3 } } }, { card: { minPayment: { pct: 5 } } });
    const before = project(card(), [payment], '2026-05-14');
    const after = project(card(), [payment, lower], '2026-05-14');
    expect(before.plan[0].lateMinor).toBe(58);
    expect(before.plan[0].minimumMinor).toBe(146_102);
    expect(before.card.minimumPastDue).toBe(true);
    expect(before.lateInterestMinor).toBeGreaterThan(0);
    expect(after.plan[0].minimumMinor).toBe(136_102);
    expect(after.card.minimumPastDue).toBe(false);
    expect(after.pastDueMinor).toBe(0);
    expect(after.lateInterestMinor).toBe(0);
    expect(after.plan[0].status).toBe('paid');
    expect(after.applied[0].eventId).toBe('p1');
    expect(after.applied[0].allocation).toEqual(before.applied[0].allocation);
  });

  it('equals the pre-correction card projection once the correction is voided', () => {
    const payment = ev('payment', '2026-04-30', 140_000, {}, 'p1');
    const lower = correction('c1', '2026-06-01', { card: { minPayment: { pct: 3 } } }, { card: { minPayment: { pct: 5 } } });
    expect(project(card(), [payment, lower, voidOf('v1', 'c1')], '2026-05-14')).toEqual(project(card(), [payment], '2026-05-14'));
  });
});
