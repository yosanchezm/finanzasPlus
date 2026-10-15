// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/errors.js';
import { applyCorrection, buildCorrection, versionTermsAt } from '../../src/ledger/correction.js';
import { planCommit } from '../../src/ledger/commit.js';
import { validateEvent } from '../../src/ledger/events.js';
import { periodicRate, toEffectiveAnnual } from '../../src/rates.js';
import { validateTerms } from '../../src/terms.js';
import { EA, debt, ev, french } from '../helpers/loans.js';

// DL1 (terms correction event): the pure pieces. A correction is validated strictly on write,
// bound to the terms version in force, and never carries a value equal to the stored one.

const cardTerms = validateTerms(JSON.parse(readFileSync(new URL('../fixtures/card-statement-independent.json', import.meta.url), 'utf8')).terms);
const card = () => debt(cardTerms);
const loan = () => debt(french({ rate: EA(28.32) }));
const ON = '2026-06-10';

const failure = (fn) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error.code;
  }
  return 'did not throw';
};

describe('buildCorrection', () => {
  it('accepts a card statement day 15 to 20 and fills previous and appliesTo', () => {
    const draft = buildCorrection(card(), [], { card: { statementDay: 20 } }, { on: ON });
    expect(draft).toEqual({
      kind: 'terms_correction',
      effectiveOn: ON,
      amountMinor: 0,
      fields: { card: { statementDay: 20 } },
      previous: { card: { statementDay: 15 } },
      appliesTo: 'opening',
    });
    const event = validateEvent({ id: 'c1', ...draft, payload: { fields: draft.fields, previous: draft.previous, appliesTo: draft.appliesTo } });
    expect(event.payload.fields).toEqual({ card: { statementDay: 20 } });
    expect(event.amountMinor).toBe(0);
  });

  it('corrects the due day and every minimum-payment part, keeping the previous values field by field', () => {
    const draft = buildCorrection(card(), [], { card: { dueDay: 25, minPayment: { rule: 'pct_balance', pct: 3, floorMinor: 10_000 } } }, { on: ON });
    expect(draft.fields).toEqual({ card: { dueDay: 25, minPayment: { rule: 'pct_balance', pct: 3, floorMinor: 10_000 } } });
    expect(draft.previous).toEqual({ card: { dueDay: 30, minPayment: { rule: 'interest_fees_plus_pct', pct: 5, floorMinor: 20_000 } } });
  });

  it('keeps only the parts that really change', () => {
    const draft = buildCorrection(card(), [], { card: { statementDay: 15, dueDay: 25, minPayment: { pct: 5, floorMinor: 10_000 } } }, { on: ON });
    expect(draft.fields).toEqual({ card: { dueDay: 25, minPayment: { floorMinor: 10_000 } } });
    expect(draft.previous).toEqual({ card: { dueDay: 30, minPayment: { floorMinor: 20_000 } } });
  });

  it('refuses card fields on a loan and writes nothing', () => {
    expect(failure(() => buildCorrection(loan(), [], { card: { statementDay: 20 } }, { on: ON }))).toBe('correction_not_applicable');
    expect(failure(() => applyCorrection(french(), { card: { dueDay: 20 } }))).toBe('correction_not_applicable');
  });

  it('refuses every unsupported field with correction_unsupported_field', () => {
    const drafts = [
      { limitMinor: 5_000_000 },
      { card: { limitMinor: 5_000_000 } },
      { card: { advanceRate: EA(35) } },
      { prepaymentPenaltyPct: 2 },
      { allocationOrder: ['interest', 'principal'] },
      { late: { mode: 'usury' } },
      { card: { statementDay: 20, deferred: [] } },
      { card: { minPayment: { pct: 3, base: 'balance' } } },
    ];
    for (const fields of drafts) expect(failure(() => buildCorrection(card(), [], fields, { on: ON }))).toBe('correction_unsupported_field');
    expect(failure(() => validateEvent({ id: 'x', kind: 'terms_correction', effectiveOn: ON, amountMinor: 0, payload: { fields: { limitMinor: 1 }, previous: {}, appliesTo: 'opening' } }))).toBe(
      'correction_unsupported_field',
    );
  });

  it('refuses an empty draft', () => {
    expect(failure(() => buildCorrection(card(), [], {}, { on: ON }))).toBe('correction_empty');
    expect(failure(() => buildCorrection(card(), [], { card: {} }, { on: ON }))).toBe('correction_empty');
    expect(failure(() => buildCorrection(card(), [], { card: { minPayment: {} } }, { on: ON }))).toBe('correction_empty');
  });

  it('refuses a value equal to the stored one with no_change', () => {
    expect(failure(() => buildCorrection(card(), [], { card: { statementDay: 15 } }, { on: ON }))).toBe('no_change');
    expect(failure(() => buildCorrection(card(), [], { card: { minPayment: { rule: 'interest_fees_plus_pct', pct: 5, floorMinor: 20_000 } } }, { on: ON }))).toBe('no_change');
    expect(failure(() => buildCorrection(loan(), [], { rate: EA(28.32) }, { on: ON }))).toBe('no_change');
  });

  it('refuses out-of-range days and a malformed rule', () => {
    expect(failure(() => buildCorrection(card(), [], { card: { statementDay: 0 } }, { on: ON }))).toBe('invalid_card');
    expect(failure(() => buildCorrection(card(), [], { card: { dueDay: 32 } }, { on: ON }))).toBe('invalid_card');
    expect(failure(() => buildCorrection(card(), [], { card: { statementDay: 10.5 } }, { on: ON }))).toBe('invalid_card');
    expect(failure(() => buildCorrection(card(), [], { card: { minPayment: { rule: 'whatever' } } }, { on: ON }))).toBe('invalid_card');
    expect(failure(() => buildCorrection(card(), [], { card: { minPayment: { pct: 101 } } }, { on: ON }))).toBe('invalid_card');
    expect(failure(() => buildCorrection(loan(), [], { rate: { value: -1, basis: 'effective', periodicity: 'annual' } }, { on: ON }))).toBe('invalid_rate');
    expect(failure(() => buildCorrection(loan(), [], { modality: 'cripto' }, { on: ON }))).toBe('invalid_terms');
  });

  it('keeps the rate as the bank states it: 25.2 % NAMV on a debt saved as 28.32 % EA is 2.1 % per month', () => {
    const draft = buildCorrection(loan(), [], { rate: { convention: 'NAMV', value: 25.2 } }, { on: ON });
    expect(draft.fields.rate).toEqual({ value: 25.2, basis: 'nominal', periodicity: 'monthly', timing: 'arrears' });
    expect(draft.previous.rate).toEqual(EA(28.32));
    const corrected = applyCorrection(loan().terms, draft.fields);
    expect(periodicRate(corrected.rate, 'monthly')).toBeCloseTo(0.021, 10);
    expect(toEffectiveAnnual(corrected.rate)).toBeCloseTo(28.32, 1);
  });

  it('corrects the modality against the effective one (a consumer loan is already consumer)', () => {
    const draft = buildCorrection(loan(), [], { modality: 'mortgage' }, { on: ON });
    expect(draft.fields).toEqual({ modality: 'mortgage' });
    expect(draft.previous).toEqual({ modality: 'consumer' });
    expect(applyCorrection(loan().terms, draft.fields).modality).toBe('mortgage');
    expect(failure(() => buildCorrection(loan(), [], { modality: 'consumer' }, { on: ON }))).toBe('no_change');
  });

  it('does not mutate its inputs', () => {
    const fields = { card: { statementDay: 20 } };
    const snapshotOfCard = JSON.stringify(cardTerms);
    buildCorrection(card(), [], fields, { on: ON });
    expect(fields).toEqual({ card: { statementDay: 20 } });
    expect(JSON.stringify(cardTerms)).toBe(snapshotOfCard);
  });
});

describe('applyCorrection', () => {
  it('returns validated terms with the card parts merged and the rest untouched', () => {
    const terms = applyCorrection(cardTerms, { card: { statementDay: 20, minPayment: { pct: 3 } } });
    expect(terms.card.statementDay).toBe(20);
    expect(terms.card.dueDay).toBe(30);
    expect(terms.card.minPayment).toEqual({ rule: 'interest_fees_plus_pct', pct: 3, floorMinor: 20_000 });
    expect(terms.card.deferred).toEqual(cardTerms.card.deferred);
    expect(terms.charges).toEqual(cardTerms.charges);
    expect(cardTerms.card.statementDay).toBe(15);
  });

  it('throws the card error for an invalid merged value', () => {
    expect(failure(() => applyCorrection(cardTerms, { card: { statementDay: 40 } }))).toBe('invalid_card');
  });
});

describe('versionTermsAt', () => {
  it('is the opening terms plus the active corrections when nothing was restructured', () => {
    const first = ev('terms_correction', '2026-05-01', 0, { fields: { card: { statementDay: 18 } }, previous: { card: { statementDay: 15 } }, appliesTo: 'opening' }, 'c1');
    const voided = ev('void', '2026-05-02', 0, { targetEventId: 'c1' }, 'v1');
    const version = versionTermsAt(card(), [first], ON);
    expect(version.appliesTo).toBe('opening');
    expect(version.terms.card.statementDay).toBe(18);
    expect(versionTermsAt(card(), [first, voided], ON).terms.card.statementDay).toBe(15);
  });

  it('binds to the last active restructure dated on or before the date', () => {
    const terms = french();
    const restructured = validateTerms({ ...terms, principalMinor: 8_000_000, openedOn: '2026-05-10', firstDueOn: '2026-06-15', rate: EA(20) });
    const events = [ev('restructure', '2026-05-10', 0, { terms: restructured }, 'r1')];
    expect(versionTermsAt(debt(terms), events, '2026-05-09').appliesTo).toBe('opening');
    const version = versionTermsAt(debt(terms), events, ON);
    expect(version.appliesTo).toBe('r1');
    expect(version.terms.rate).toEqual(EA(20));
    const draft = buildCorrection(debt(terms), events, { rate: EA(21) }, { on: ON });
    expect(draft.appliesTo).toBe('r1');
    expect(draft.previous.rate).toEqual(EA(20));
  });
});

describe('planCommit with a correction', () => {
  const ctx = { eventId: 'corr1', dedupeKey: 'web:c1', actorId: 'u1', source: 'web' };
  const { kind, effectiveOn, fields, previous, appliesTo } = buildCorrection(card(), [], { card: { statementDay: 20 } }, { on: ON });

  it('plans one event with a payload that fits the limit and an amount of 0', () => {
    const plan = planCommit(card(), [], { kind, effectiveOn, fields, previous, appliesTo }, ctx);
    expect(plan.event.data.kind).toBe('terms_correction');
    expect(plan.event.data.amountMinor).toBe(0);
    expect(plan.event.data.payloadJson.length).toBeLessThan(8000);
    expect(JSON.parse(plan.event.data.payloadJson)).toEqual({ fields, previous, appliesTo });
    expect(plan.costRow).toBeNull();
  });

  it('throws on terms that would not validate and writes nothing', () => {
    const bad = { kind, effectiveOn, fields: { card: { statementDay: 20 } }, previous, appliesTo: 'r-missing' };
    expect(failure(() => planCommit(card(), [], bad, ctx))).toBe('correction_target_missing');
    expect(failure(() => planCommit(loan(), [], { kind, effectiveOn, fields, previous, appliesTo }, ctx))).toBe('correction_not_applicable');
  });
});
