// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { periodDates } from '../../src/calendar.js';
import { planCommit } from '../../src/ledger/commit.js';
import { previewChange } from '../../src/ledger/preview.js';
import { project } from '../../src/ledger/project.js';
import { buildRestructureTerms, restructureCarry } from '../../src/ledger/restructure.js';
import { resolveLegal } from '../../src/legal.js';
import { validateTerms } from '../../src/terms.js';
import { EA, debt, deepFreeze, ev, french, onTime } from '../helpers/loans.js';

// C3b (DL2, DL3): the figures a restructure refinances and the terms it starts from.
// Golden: 10,000,000 at 24% EA, fee 10,000, usury cap 28.59%; the first installment (390,381) is 10 days late on 2026-02-25.

const fixture = JSON.parse(readFileSync(new URL('../fixtures/late-28.59-golden.json', import.meta.url), 'utf8'));
const cardTerms = JSON.parse(readFileSync(new URL('../fixtures/card-statement-independent.json', import.meta.url), 'utf8')).terms;
const LEGAL = resolveLegal([], { usuryTable: fixture.usuryTable });
const DUE = '2026-02-15';
const DAY_10 = '2026-02-25';
const MORA = french({ charges: fixture.terms.charges, late: { mode: 'usury' } });
const withLegal = (terms = MORA) => ({ ...debt(terms), legal: LEGAL });
const pay = (on, amountMinor, id) => ev('payment', on, amountMinor, {}, id);
const codeOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.code;
  }
  return 'did not throw';
};

describe('restructureCarry: the breakdown of what a restructure refinances', () => {
  it('golden: the 390,381 installment 10 days late carries charges, interest and the 1,375 of mora next to the whole balance', () => {
    const carry = restructureCarry(withLegal(), [], DAY_10);
    expect(carry).toEqual({
      balanceMinor: 10_000_000,
      arrears: { interest: 180_876, charges: 10_000, taxes: 0, lateInterest: 1375 },
      carriedMinor: 10_192_251,
      waivableLateMinor: 1375,
    });
    expect(carry.carriedMinor).toBe(carry.balanceMinor + 180_876 + 10_000 + 0 + 1375);
  });

  it('equals the carried balance that the saved restructure reports, and waiving takes the mora out of it', () => {
    const terms = buildRestructureTerms(project(withLegal(), [], DAY_10).terms, { effectiveOn: DAY_10, carriedMinor: 10_192_251, overrides: { firstDueOn: '2026-04-15', n: 24 } });
    const entryOf = (waiveLate) =>
      project(withLegal(), [ev('restructure', DAY_10, 0, { terms, ...(waiveLate ? { waiveLate } : {}) }, 'rs1')], DAY_10).applied[0];
    const carry = restructureCarry(withLegal(), [], DAY_10);
    expect(entryOf(false).carriedMinor).toBe(carry.carriedMinor);
    expect(entryOf(true).carriedMinor).toBe(carry.carriedMinor - carry.waivableLateMinor);
    expect(entryOf(true).waivedLateMinor).toBe(carry.waivableLateMinor);
  });

  it('after a short payment only what is still unpaid is carried: no mora left, interest reduced', () => {
    const carry = restructureCarry(withLegal(), [pay(DAY_10, 100_000, 'p1')], DAY_10);
    expect(carry.arrears).toEqual({ interest: 92_251, charges: 0, taxes: 0, lateInterest: 0 });
    expect(carry).toMatchObject({ balanceMinor: 10_000_000, waivableLateMinor: 0, carriedMinor: 10_092_251 });
  });

  it('adds up the mora of every overdue row, and matches the projection', () => {
    const projection = project(withLegal(), [], '2026-03-17');
    const carry = restructureCarry(withLegal(), [], '2026-03-17');
    expect(projection.plan.filter((row) => row.lateMinor > 0)).toHaveLength(2);
    expect(carry.waivableLateMinor).toBe(projection.lateInterestMinor);
    expect(carry.arrears.lateInterest).toBe(projection.totals.remainingLateInterest);
    expect(carry.arrears.interest).toBe(projection.plan.filter((row) => row.dueOn <= '2026-03-17').reduce((sum, row) => sum + row.interestMinor, 0));
  });

  it('counts the installment due exactly on the date, with no mora yet; nothing is carried before the first due date', () => {
    expect(restructureCarry(withLegal(), [], DUE)).toMatchObject({ arrears: { interest: 180_876, charges: 10_000, taxes: 0, lateInterest: 0 }, waivableLateMinor: 0 });
    expect(restructureCarry(withLegal(), [], '2026-01-20')).toEqual({
      balanceMinor: 10_000_000,
      arrears: { interest: 0, charges: 0, taxes: 0, lateInterest: 0 },
      carriedMinor: 10_000_000,
      waivableLateMinor: 0,
    });
  });

  it('without a mora policy the arrears have no mora, and later or voided events are left out', () => {
    const plain = french({ charges: fixture.terms.charges });
    expect(restructureCarry(withLegal(plain), [], DAY_10).arrears).toEqual({ interest: 180_876, charges: 10_000, taxes: 0, lateInterest: 0 });
    const later = pay('2026-03-01', 390_381, 'later');
    const voided = pay(DUE, 390_381, 'voided');
    const voidEvent = ev('void', DAY_10, 0, { targetEventId: 'voided', reason: 'typo' }, 'v1');
    expect(restructureCarry(withLegal(), [later, voided, voidEvent], DAY_10).carriedMinor).toBe(10_192_251);
  });

  it('a balance-only debt carries its balance and nothing else', () => {
    const family = { kind: 'informal', principalMinor: 1_000_000, openedOn: '2026-01-10', rate: { convention: 'ZERO' }, system: 'none' };
    expect(restructureCarry(debt(family), [pay('2026-02-10', 200_000, 'p1')], '2026-03-01')).toEqual({
      balanceMinor: 800_000,
      arrears: { interest: 0, charges: 0, taxes: 0, lateInterest: 0 },
      carriedMinor: 800_000,
      waivableLateMinor: 0,
    });
  });

  it('refuses a card with a typed error, a bad date, and leaves frozen inputs alone', () => {
    expect(codeOf(() => restructureCarry(debt(cardTerms), [], DAY_10))).toBe('restructure_unsupported');
    expect(codeOf(() => restructureCarry(withLegal(), [], '25/02/2026'))).toBe('invalid_date');
    const frozen = deepFreeze([pay(DUE, 100_000, 'p1')]);
    expect(restructureCarry(deepFreeze(withLegal()), frozen, DAY_10).carriedMinor).toBeGreaterThan(10_000_000);
  });
});

describe('buildRestructureTerms: the terms a restructure starts from', () => {
  const current = () => project(withLegal(), [], DAY_10).terms;
  const build = (overrides = {}, extra = {}) => buildRestructureTerms(current(), { effectiveOn: DAY_10, carriedMinor: 10_192_251, overrides: { firstDueOn: '2026-04-15', n: 24, ...overrides }, ...extra });

  it('carries the balance as the new principal, opens on the effective date and keeps rate, charges and the mora policy', () => {
    const terms = build();
    expect(terms).toEqual(validateTerms(terms));
    expect(terms).toMatchObject({ kind: 'consumer', principalMinor: 10_192_251, openedOn: DAY_10, system: 'french', periodicity: 'monthly', n: 24, firstDueOn: '2026-04-15', late: { mode: 'usury', graceDays: 0 } });
    expect(terms.rate).toEqual(EA(24));
    expect(terms.charges).toEqual(validateTerms(MORA).charges);
  });

  it('applies the overrides, and a mora policy of the overrides wins over the inherited one', () => {
    const terms = build({ rate: EA(18), system: 'german', periodicity: 'monthly', late: { mode: 'fixed', rate: EA(25), graceDays: 2 }, charges: [] });
    expect(terms).toMatchObject({ rate: EA(18), system: 'german', charges: [], late: { mode: 'fixed', rate: EA(25), graceDays: 2 } });
    expect(build({ late: { mode: 'none' } }).late).toEqual({ mode: 'none', graceDays: 0 });
  });

  it('stays without mora terms when the current ones have none', () => {
    const plain = project(withLegal(french()), [], DAY_10).terms;
    expect(buildRestructureTerms(plain, { effectiveOn: DAY_10, carriedMinor: 5_000_000, overrides: { firstDueOn: '2026-03-15', n: 12 } }).late).toBeUndefined();
  });

  it('rejects a first due date that is not after the effective date, including the one left over from the old plan', () => {
    expect(codeOf(() => build({ firstDueOn: DAY_10 }))).toBe('invalid_first_due');
    expect(codeOf(() => build({ firstDueOn: '2026-02-24' }))).toBe('invalid_first_due');
    expect(codeOf(() => build({ firstDueOn: undefined }))).toBe('invalid_first_due');
    expect(build({ firstDueOn: '2026-02-26' }).firstDueOn).toBe('2026-02-26');
  });

  it('leaves the old grace, balloon and fixed day behind unless the overrides set them', () => {
    const graceful = project(withLegal(french({ charges: fixture.terms.charges, late: { mode: 'usury' }, grace: { periods: 2, type: 'total' }, dueDay: 15 })), [], DAY_10).terms;
    expect(graceful.grace).toEqual({ periods: 2, type: 'total' });
    const terms = buildRestructureTerms(graceful, { effectiveOn: DAY_10, carriedMinor: 10_000_000, overrides: { firstDueOn: '2026-04-15', n: 12 } });
    expect(terms.grace).toBeUndefined();
    expect(terms.dueDay).toBeUndefined();
    expect(buildRestructureTerms(graceful, { effectiveOn: DAY_10, carriedMinor: 10_000_000, overrides: { firstDueOn: '2026-04-15', n: 12, grace: { periods: 1, type: 'principal' } } }).grace).toEqual({ periods: 1, type: 'principal' });
  });

  it('can turn the debt into a balance-only one, which needs no first due date', () => {
    const terms = buildRestructureTerms(current(), { effectiveOn: DAY_10, carriedMinor: 10_192_251, overrides: { system: 'none', kind: 'informal' } });
    expect(terms).toMatchObject({ system: 'none', principalMinor: 10_192_251, kind: 'informal' });
    expect(terms.firstDueOn).toBeUndefined();
  });

  it('refuses a card, a carried balance of 0 and an invalid override with the terms error', () => {
    expect(codeOf(() => buildRestructureTerms(validateTerms(cardTerms), { effectiveOn: DAY_10, carriedMinor: 1_000_000, overrides: { firstDueOn: '2026-04-15' } }))).toBe('restructure_unsupported');
    expect(codeOf(() => build({}, { carriedMinor: 0 }))).toBe('invalid_principal');
    expect(codeOf(() => build({ n: 0 }))).toBe('invalid_terms');
    expect(codeOf(() => build({ late: { mode: 'fixed' } }))).toBe('invalid_late');
    expect(codeOf(() => build({}, { effectiveOn: 'tomorrow' }))).toBe('invalid_date');
  });

  it('does not mutate the current terms or the overrides', () => {
    const frozen = deepFreeze(current());
    const overrides = deepFreeze({ firstDueOn: '2026-04-15', n: 24, charges: [] });
    expect(buildRestructureTerms(frozen, { effectiveOn: DAY_10, carriedMinor: 10_000_000, overrides }).charges).toEqual([]);
    expect(frozen.charges).toHaveLength(1);
  });
});

describe('previewChange of a restructure built from the carry (DL2)', () => {
  const draft = (waiveLate = false, overrides = {}) => {
    const carry = restructureCarry(withLegal(), [], DAY_10);
    const terms = buildRestructureTerms(project(withLegal(), [], DAY_10).terms, { effectiveOn: DAY_10, carriedMinor: carry.carriedMinor, overrides: { firstDueOn: '2026-04-15', n: 24, ...overrides } });
    return { kind: 'restructure', effectiveOn: DAY_10, terms, ...(waiveLate ? { waiveLate } : {}) };
  };

  it('the balance after the preview is the carried balance of the breakdown, less the mora when it is waived', () => {
    const carry = restructureCarry(withLegal(), [], DAY_10);
    const keep = previewChange(withLegal(), [], draft(), { on: DAY_10 });
    const waive = previewChange(withLegal(), [], draft(true), { on: DAY_10 });
    expect(keep.after.balanceMinor).toBe(carry.carriedMinor);
    expect(waive.after.balanceMinor).toBe(carry.carriedMinor - 1375);
    expect(keep.before).toMatchObject({ lateInterestMinor: 1375, pastDueMinor: 391_756 });
    expect(keep.after).toMatchObject({ lateInterestMinor: 0, pastDueMinor: 0, remainingPeriods: 24, nextDueOn: '2026-04-15' });
  });

  it('flags a payload over 8000 characters, and planCommit refuses to write it', () => {
    const dates = periodDates('2026-04-15', 'monthly', 450);
    const big = draft(true, { system: 'manual', n: 450, manualPlan: dates.map((date) => [date, 250_000]) });
    const preview = previewChange(withLegal(), [], big, { on: DAY_10 });
    expect(preview.payloadChars).toBe(JSON.stringify({ terms: validateTerms(big.terms), waiveLate: true }).length);
    expect(preview.payloadChars).toBeGreaterThan(8000);
    const ctx = { eventId: 'saved1', dedupeKey: 'web:n1', actorId: 'u1', source: 'web' };
    expect(codeOf(() => planCommit(withLegal(), [], big, ctx))).toBe('payload_too_large');
    expect(previewChange(withLegal(), [], draft(), { on: DAY_10 }).payloadChars).toBeLessThan(8000);
  });

  it('a backdated restructure lists the later payment whose cost changes, with its cost before and after', () => {
    const paid = onTime(french(), 3);
    const later = pay('2026-05-15', 380_381, 'later1'); // already recorded against the old plan
    const events = [...paid, later];
    const baseDebt = debt(french());
    const terms = buildRestructureTerms(project(baseDebt, paid, '2026-05-01').terms, { effectiveOn: '2026-05-01', carriedMinor: project(baseDebt, paid, '2026-05-01').balanceMinor, overrides: { rate: EA(12), firstDueOn: '2026-06-15', n: 24 } });
    const result = previewChange(baseDebt, events, { kind: 'restructure', effectiveOn: '2026-05-01', terms }, { on: '2026-05-20' });
    const costOf = (projection) => projection.applied.find((entry) => entry.eventId === 'later1').costMinor;
    const after = project(baseDebt, [...events, { id: 'preview:change', kind: 'restructure', effectiveOn: '2026-05-01', amountMinor: 0, payload: { terms }, createdAt: '9999-12-31T23:59:59.999Z' }], '2026-05-20');
    expect(result.backdated).toBe(true);
    expect(result.impacted).toHaveLength(1);
    expect(result.impacted[0]).toMatchObject({ eventId: 'later1', kind: 'payment', effectiveOn: '2026-05-15', costBeforeMinor: costOf(project(baseDebt, events, '2026-05-20')), costAfterMinor: costOf(after) });
    expect(result.impacted[0].costAfterMinor).not.toBe(result.impacted[0].costBeforeMinor);
    const today = previewChange(baseDebt, paid, { kind: 'restructure', effectiveOn: '2026-05-20', terms: { ...terms, openedOn: '2026-05-20', firstDueOn: '2026-06-20' } }, { on: '2026-05-20' });
    expect(today).toMatchObject({ backdated: false, impacted: [] });
  });
});
