// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dailyRate } from '../../src/late/policy.js';
import { planCommit } from '../../src/ledger/commit.js';
import { validateEvent } from '../../src/ledger/events.js';
import { previewChange } from '../../src/ledger/preview.js';
import { project } from '../../src/ledger/project.js';
import { snapshot } from '../../src/ledger/snapshot.js';
import { resolveLegal } from '../../src/legal.js';
import { EA, debt, deepFreeze, ev, french } from '../helpers/loans.js';

// C3a (LI7, DL3, DL4, DL6): the `late_policy` event, `waiveLate` on a restructure, voids of plan
// changes and the preview of a mora policy. Golden: 10,000,000 at 24% EA, fee 10,000, usury cap 28.59%.

const fixture = JSON.parse(readFileSync(new URL('../fixtures/late-28.59-golden.json', import.meta.url), 'utf8'));
const LEGAL = resolveLegal([], { usuryTable: fixture.usuryTable });
const DUE = '2026-02-15'; // first installment: 390,381 (charges 10,000, interest 180,876, principal 199,505)
const DAY_10 = '2026-02-25';
const BASE = french({ charges: fixture.terms.charges }); // no mora policy at all
const withLegal = (terms = BASE) => ({ ...debt(terms), legal: LEGAL });
const run = (events, asOf, terms = BASE) => project(withLegal(terms), events, asOf);
const policy = (effectiveOn, late, id) => ev('late_policy', effectiveOn, 0, { late }, id);
const voidOf = (target, on = '2026-03-01', id = `v-${target}`) => ev('void', on, 0, { targetEventId: target, reason: 'typo' }, id);
const pay = (on, amountMinor, id) => ev('payment', on, amountMinor, {}, id);
const accrued = (days, ea = 28.59, base = 199_505) => Math.round(base * dailyRate(ea) * days);
const codeOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.code;
  }
  return 'did not throw';
};
const ctx = { eventId: 'saved1', dedupeKey: 'web:n1', actorId: 'u1', source: 'web' };

describe('late_policy: mora only for days after the effective date (LI7)', () => {
  it('a policy effective on the due date makes the following 10 days accrue 1,375 on 199,505', () => {
    const projection = run([policy(DUE, { mode: 'usury' }, 'lp1')], DAY_10);
    expect(projection.plan[0]).toMatchObject({ lateMinor: 1375, lateDays: 10, lateBaseMinor: 199_505, outstandingMinor: 391_756 });
    expect(projection).toMatchObject({ pastDueMinor: 391_756, lateInterestMinor: 1375 });
    expect(projection.applied[0]).toMatchObject({ eventId: 'lp1', kind: 'late_policy', allocation: null, costMinor: 0 });
    expect(projection.terms.late).toEqual({ mode: 'usury', graceDays: 0 });
  });

  it('a policy effective today accrues nothing, keeps the cost of earlier payments, and the next days start counting', () => {
    const early = pay('2026-02-20', 100_000, 'p1'); // 5 days overdue, before the policy exists
    const baseline = run([early], DAY_10);
    const today = run([early, policy(DAY_10, { mode: 'usury' }, 'lp1')], DAY_10);
    expect(today.lateInterestMinor).toBe(0);
    expect(today.plan[0].lateDays).toBe(0);
    expect(today.applied[0]).toEqual(baseline.applied[0]);
    expect(today.applied[0].allocation.lateInterest).toBe(0);
    const later = run([early, policy(DAY_10, { mode: 'usury' }, 'lp1')], '2026-03-02');
    expect(later.plan[0].lateDays).toBe(5);
    expect(later.applied[0]).toEqual(baseline.applied[0]);
  });

  it('20 days overdue with the policy effective today accrues 0, and 5 days later it covers 5 days', () => {
    const events = [policy('2026-03-07', { mode: 'usury' }, 'lp1')];
    expect(run(events, '2026-03-07')).toMatchObject({ lateInterestMinor: 0 });
    expect(run(events, '2026-03-07').pastDueMinor).toBe(390_381);
    const fiveLater = run(events, '2026-03-12');
    expect(fiveLater.plan[0]).toMatchObject({ lateDays: 5, lateMinor: accrued(5) });
    expect(fiveLater.lateInterestMinor).toBe(687);
  });

  it('a policy dated after asOf is not applied yet', () => {
    expect(run([policy('2026-03-20', { mode: 'usury' }, 'lp1')], DAY_10)).toMatchObject({ lateInterestMinor: 0 });
  });

  it('the latest non-voided policy applies from its own date: usury, then none, then a fixed 20%', () => {
    const events = [
      policy(DUE, { mode: 'usury' }, 'lp1'),
      policy('2026-02-20', { mode: 'none' }, 'lp2'),
      policy(DAY_10, { mode: 'fixed', rate: EA(20) }, 'lp3'),
    ];
    const projection = run(events, '2026-03-02');
    expect(projection.plan[0].lateMinor).toBe(Math.round(199_505 * (dailyRate(28.59) * 5 + dailyRate(20) * 5)));
    expect(projection.plan[0].lateDays).toBe(10);
    // Voiding the middle `none` lets the first policy run until the third one starts.
    const voided = run([...events, voidOf('lp2')], '2026-03-02');
    expect(voided.plan[0].lateMinor).toBe(Math.round(199_505 * (dailyRate(28.59) * 10 + dailyRate(20) * 5)));
    expect(voided.plan[0].lateDays).toBe(15);
  });

  it('the order of the events does not depend on the storage order', () => {
    const events = [policy('2026-02-20', { mode: 'none' }, 'lp2'), policy(DUE, { mode: 'usury' }, 'lp1')];
    expect(run(events, '2026-03-01')).toEqual(run(events.slice().reverse(), '2026-03-01'));
    expect(run(events, '2026-03-01').plan[0].lateMinor).toBe(accrued(5));
  });

  it('grace days of the policy delay the first accruing day', () => {
    const projection = run([policy(DUE, { mode: 'usury', graceDays: 3 }, 'lp1')], DAY_10);
    expect(projection.plan[0]).toMatchObject({ lateDays: 7, lateMinor: accrued(7) });
  });

  it('a policy over a debt that already had terms.late replaces it from the effective date', () => {
    const terms = french({ charges: fixture.terms.charges, late: { mode: 'usury' } });
    const projection = run([policy('2026-02-20', { mode: 'none' }, 'lp1')], '2026-03-01', terms);
    expect(projection.plan[0].lateMinor).toBe(accrued(5));
    expect(projection.terms.late).toEqual({ mode: 'none', graceDays: 0 });
  });
});

describe('late_policy: void and append-only (DL6, DL4)', () => {
  const payments = [pay('2026-02-20', 100_000, 'p1')];

  it('voiding a policy gives exactly the projection without it', () => {
    const base = run(payments, '2026-03-20');
    const withPolicy = run([...payments, policy(DUE, { mode: 'usury' }, 'lp1')], '2026-03-20');
    expect(withPolicy.lateInterestMinor).toBeGreaterThan(0);
    expect(run([...payments, policy(DUE, { mode: 'usury' }, 'lp1'), voidOf('lp1')], '2026-03-20')).toEqual(base);
  });

  it('voiding a rate_change or a charge_change gives exactly the projection without it', () => {
    const rate = ev('rate_change', '2026-05-01', 0, { rate: EA(18), mode: 'keep_term' }, 'r1');
    const charges = ev('charge_change', '2026-05-01', 0, { charges: [{ id: 'fee', kind: 'fee', label: 'Fee', basis: 'fixed', value: 12_000 }] }, 'c1');
    const base = run(payments, '2026-06-20');
    expect(run([...payments, rate], '2026-06-20')).not.toEqual(base);
    expect(run([...payments, charges], '2026-06-20')).not.toEqual(base);
    expect(run([...payments, rate, voidOf('r1', '2026-05-02')], '2026-06-20')).toEqual(base);
    expect(run([...payments, charges, voidOf('c1', '2026-05-02')], '2026-06-20')).toEqual(base);
  });

  it('a second policy is appended and the first event is left untouched', () => {
    const first = deepFreeze([policy(DUE, { mode: 'usury' }, 'lp1')]);
    const draft = { kind: 'late_policy', effectiveOn: '2026-02-20', late: { mode: 'fixed', rate: EA(20), graceDays: 2 } };
    const plan = planCommit(withLegal(), first, draft, { ...ctx, eventId: 'lp2' });
    expect(plan.event).toMatchObject({ id: 'lp2', data: { kind: 'late_policy', amountMinor: 0, dedupeKey: 'web:n1' } });
    expect(JSON.parse(plan.event.data.payloadJson)).toEqual({ late: { mode: 'fixed', rate: EA(20), graceDays: 2 } });
    expect(plan.costRow).toBeNull();
    expect(plan.costMinor).toBe(0);
    expect(plan.projection.terms.late).toMatchObject({ mode: 'fixed', graceDays: 2 });
    expect(first).toHaveLength(1);
    expect(first[0].payloadJson).toBe(JSON.stringify({ late: { mode: 'usury' } }));
  });

  it('planCommit refuses an invalid policy and writes nothing', () => {
    expect(codeOf(() => planCommit(withLegal(), [], { kind: 'late_policy', effectiveOn: DUE, late: { mode: 'fixed' } }, ctx))).toBe('invalid_late');
    expect(codeOf(() => planCommit(withLegal(), [], { kind: 'late_policy', effectiveOn: DUE }, ctx))).toBe('invalid_event');
  });
});

describe('late_policy: validation (normalizeLate on the payload)', () => {
  const event = (payload, overrides = {}) => ({ id: 'lp1', kind: 'late_policy', effectiveOn: DUE, amountMinor: 0, payload, ...overrides });

  it('normalizes the policy of the payload and drops the fields its mode does not use', () => {
    expect(validateEvent(event({ late: { mode: 'usury', rate: EA(40) } })).payload).toEqual({ late: { mode: 'usury', graceDays: 0 } });
    expect(validateEvent(event({ late: { mode: 'contract_multiple', multiple: 1.5, graceDays: 5 } })).payload).toEqual({
      late: { mode: 'contract_multiple', multiple: 1.5, graceDays: 5 },
    });
    expect(validateEvent(event({ late: { mode: 'none' } })).payload).toEqual({ late: { mode: 'none', graceDays: 0 } });
  });

  it('rejects what normalizeLate rejects, a missing policy, and an amount', () => {
    expect(codeOf(() => validateEvent(event({ late: { mode: 'weekly' } })))).toBe('invalid_late');
    expect(codeOf(() => validateEvent(event({ late: { mode: 'fixed' } })))).toBe('invalid_late');
    expect(codeOf(() => validateEvent(event({ late: { mode: 'contract_multiple', multiple: 4 } })))).toBe('invalid_late');
    expect(codeOf(() => validateEvent(event({ late: { mode: 'usury', graceDays: 91 } })))).toBe('invalid_late');
    expect(codeOf(() => validateEvent(event({})))).toBe('invalid_event');
    expect(codeOf(() => validateEvent(event({ late: { mode: 'usury' } }, { amountMinor: 100 })))).toBe('invalid_event');
  });
});

describe('previewChange accepts a late_policy draft', () => {
  const draft = (overrides = {}) => ({ kind: 'late_policy', effectiveOn: DUE, late: { mode: 'usury' }, ...overrides });

  it('shows the mora as of the reference date before and after, and equals the saved projection', () => {
    const result = previewChange(withLegal(), [], draft(), { on: DAY_10 });
    expect(result.before).toMatchObject({ lateInterestMinor: 0, pastDueMinor: 390_381 });
    expect(result.after).toMatchObject({ lateInterestMinor: 1375, pastDueMinor: 391_756 });
    expect(result.after.remainingCostMinor - result.before.remainingCostMinor).toBe(1375);
    expect(result).toMatchObject({ backdated: true, impacted: [] });
    expect(result.payloadChars).toBe(JSON.stringify({ late: { mode: 'usury', graceDays: 0 } }).length);
    const saved = planCommit(withLegal(), [], draft(), { ...ctx, asOf: DAY_10 });
    expect(result.after).toEqual(snapshot(saved.projection, DAY_10));
  });

  it('a policy effective today previews 0, and its impacted list shows the payments whose cost moves', () => {
    const today = previewChange(withLegal(), [], draft({ effectiveOn: DAY_10 }), { on: DAY_10 });
    expect(today.after.lateInterestMinor).toBe(0);
    expect(today).toMatchObject({ backdated: false, impacted: [] });
    const paid = [pay(DAY_10, 390_381, 'p1')];
    const backdated = previewChange(withLegal(), paid, draft(), { on: DAY_10 });
    expect(backdated.impacted).toEqual([{ eventId: 'p1', kind: 'payment', effectiveOn: DAY_10, costBeforeMinor: 190_876, costAfterMinor: 192_251 }]);
  });

  it('refuses an invalid policy with the policy code and keeps refusing other kinds', () => {
    expect(codeOf(() => previewChange(withLegal(), [], draft({ late: { mode: 'fixed' } }), { on: DAY_10 }))).toBe('invalid_late');
    expect(codeOf(() => previewChange(withLegal(), [], { kind: 'payment', effectiveOn: DUE, amountMinor: 1 }, { on: DAY_10 }))).toBe('invalid_draft');
  });
});

describe('restructure: waiveLate and the mora of the refinanced rows (DL3)', () => {
  const withMora = french({ charges: fixture.terms.charges, late: { mode: 'usury' } });
  const next = (overrides = {}) =>
    french({ principalMinor: 7_000_000, n: 24, firstDueOn: '2026-04-15', openedOn: DAY_10, charges: fixture.terms.charges, ...overrides });
  const restructure = (payload, on = DAY_10, id = 'rs1') => ev('restructure', on, 0, payload, id);
  const entryOf = (projection) => projection.applied.find((entry) => entry.kind === 'restructure');

  it('capitalizes the arrears with the mora, 391,756 for the 390,381 installment on day 10', () => {
    const projection = run([restructure({ terms: next() })], '2026-03-01', withMora);
    expect(projection.plan[0]).toMatchObject({ refinancedMinor: 391_756, status: 'paid', outstandingMinor: 0, lateMinor: 1375 });
    expect(entryOf(projection)).toMatchObject({ costMinor: 0, allocation: null });
    expect(entryOf(projection).waivedLateMinor).toBeUndefined();
  });

  it('waiveLate refinances 390,381 and records the forgiven 1,375 without any cost', () => {
    const projection = run([restructure({ terms: next(), waiveLate: true })], '2026-03-01', withMora);
    const kept = run([restructure({ terms: next() })], '2026-03-01', withMora);
    expect(projection.plan[0]).toMatchObject({ refinancedMinor: 390_381, status: 'paid', outstandingMinor: 0 });
    expect(entryOf(projection)).toMatchObject({ waivedLateMinor: 1375, costMinor: 0, allocation: null });
    expect(entryOf(kept).carriedMinor - entryOf(projection).carriedMinor).toBe(1375);
    expect(projection.balanceMinor).toBe(entryOf(projection).carriedMinor);
    expect(projection.lateInterestMinor).toBe(0);
    expect(projection.totals.remainingLateInterest).toBe(0);
  });

  it('waives only the unpaid mora: nothing when the mora was already paid, every overdue row when two are late', () => {
    const settled = run([pay(DAY_10, 100_000, 'p1'), restructure({ terms: next(), waiveLate: true })], '2026-03-01', withMora);
    expect(entryOf(settled).waivedLateMinor).toBe(0);
    const before = run([], '2026-03-17', withMora);
    expect(before.plan.filter((row) => row.lateMinor > 0)).toHaveLength(2);
    const two = run([restructure({ terms: next({ openedOn: '2026-03-17', firstDueOn: '2026-04-20' }), waiveLate: true }, '2026-03-17')], '2026-03-18', withMora);
    expect(entryOf(two).waivedLateMinor).toBe(before.lateInterestMinor);
    expect(before.lateInterestMinor).toBeGreaterThan(4125);
  });

  it('no mora accrues on the replaced rows after the restructure', () => {
    const events = [restructure({ terms: next() })];
    const atDate = run(events, DAY_10, withMora);
    const later = run(events, '2026-03-30', withMora);
    expect(later.plan[0]).toMatchObject({ lateMinor: 1375, lateDays: 10, outstandingMinor: 0 });
    expect(later.plan[0].lateMinor).toBe(atDate.plan[0].lateMinor);
    expect(later.lateInterestMinor).toBe(0);
    expect(later.pastDueMinor).toBe(0);
  });

  it('the new terms inherit the previous mora policy unless the draft sets another', () => {
    const inherited = run([restructure({ terms: next() })], '2026-04-25', withMora);
    expect(inherited.terms.late).toEqual({ mode: 'usury', graceDays: 0 });
    expect(inherited.plan[1]).toMatchObject({ dueOn: '2026-04-15', lateDays: 10 });
    expect(inherited.lateInterestMinor).toBeGreaterThan(0);
    const replaced = run([restructure({ terms: next({ late: { mode: 'none' } }) })], '2026-04-25', withMora);
    expect(replaced.terms.late).toEqual({ mode: 'none', graceDays: 0 });
    expect(replaced.lateInterestMinor).toBe(0);
  });

  it('inherits a policy that came from a late_policy event, and stays without mora when there was none', () => {
    const viaEvent = run([policy(DUE, { mode: 'fixed', rate: EA(20) }, 'lp1'), restructure({ terms: next() })], '2026-04-25');
    expect(viaEvent.terms.late).toMatchObject({ mode: 'fixed' });
    expect(viaEvent.lateInterestMinor).toBeGreaterThan(0);
    const none = run([restructure({ terms: next() })], '2026-04-25');
    expect(none.terms.late).toBeUndefined();
    expect(none.lateInterestMinor).toBe(0);
  });

  it('previewChange of a restructure with waiveLate shows the mora gone and the carried balance lower', () => {
    const draft = (waiveLate) => ({ kind: 'restructure', effectiveOn: DAY_10, terms: next(), ...(waiveLate ? { waiveLate } : {}) });
    const debtWithMora = { ...withLegal(withMora) };
    const keep = previewChange(debtWithMora, [], draft(false), { on: DAY_10 });
    const waive = previewChange(debtWithMora, [], draft(true), { on: DAY_10 });
    expect(keep.before.lateInterestMinor).toBe(1375);
    expect(keep.after.lateInterestMinor).toBe(0);
    expect(keep.after.balanceMinor - waive.after.balanceMinor).toBe(1375);
    expect(waive.payloadChars - keep.payloadChars).toBe(',"waiveLate":true'.length);
  });
});

describe('restructure: waiveLate in the payload', () => {
  const terms = french({ openedOn: DAY_10, firstDueOn: '2026-04-15', n: 12 });
  const event = (payload) => ({ id: 'rs1', kind: 'restructure', effectiveOn: DAY_10, amountMinor: 0, payload });

  it('stores waiveLate only when it is true, so older payloads stay byte-identical', () => {
    expect(Object.keys(validateEvent(event({ terms, waiveLate: true })).payload)).toEqual(['terms', 'waiveLate']);
    expect(validateEvent(event({ terms, waiveLate: true })).payload.waiveLate).toBe(true);
    expect(Object.keys(validateEvent(event({ terms, waiveLate: false })).payload)).toEqual(['terms']);
    expect(Object.keys(validateEvent(event({ terms })).payload)).toEqual(['terms']);
  });

  it('rejects a waiveLate that is not a boolean', () => {
    expect(codeOf(() => validateEvent(event({ terms, waiveLate: 'yes' })))).toBe('invalid_event');
    expect(codeOf(() => validateEvent(event({ terms, waiveLate: 1 })))).toBe('invalid_event');
  });
});
