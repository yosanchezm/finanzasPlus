import { project } from '@finance-core';
import { describe, expect, it } from 'vitest';
import { evaluate, initialWizard, stepsFor, toTerms, wizardReducer } from './wizardModel';

const TODAY = '2026-10-12';
const run = (actions, start = initialWizard(TODAY)) => actions.reduce(wizardReducer, start);
const card = (patch = {}, set = {}) => run([
  { type: 'kind', kind: 'card' },
  { type: 'set', patch: { name: 'Visa', principal: '500000', ...set } },
  { type: 'rate', patch: { value: '28' } },
  { type: 'card', patch: { statementDay: '15', dueDay: '30', fee: '9000', ...patch } },
]);
const NEVERA = { label: 'Nevera', amount: '1200000', n: '12', rate: '0' };

describe('card wizard model', () => {
  it('has its own step between the rate and the review, and defaults to the usual minimum rule with IVA on the fee', () => {
    expect(stepsFor('card')).toEqual(['kind', 'basics', 'rate', 'card', 'review']);
    expect(run([{ type: 'kind', kind: 'card' }])).toMatchObject({
      system: 'none',
      card: { minRule: 'interest_fees_plus_pct', minPct: '5', feeIva: true, feeIvaPct: '19', deferred: [] },
    });
  });

  it('builds valid card terms: opening balance, days, minimum rule, fee and its IVA link', () => {
    expect(toTerms(card())).toMatchObject({
      kind: 'card',
      principalMinor: 500000,
      system: 'none',
      rate: { value: 28 },
      card: { statementDay: 15, dueDay: 30, minPayment: { rule: 'interest_fees_plus_pct', pct: 5, floorMinor: 0 }, deferred: [] },
      charges: [
        { id: 'mgmt_fee', kind: 'fee', basis: 'fixed', value: 9000 },
        { id: 'mgmt_iva', kind: 'tax', basis: 'pctOfCharge', refId: 'mgmt_fee', value: 19 },
      ],
    });
  });

  it('lets the user edit or remove the IVA link, or leave the fee out', () => {
    expect(toTerms(card({ feeIvaPct: '16' })).charges[1]).toMatchObject({ id: 'mgmt_iva', value: 16 });
    expect(toTerms(card({ feeIva: false })).charges.map((charge) => charge.id)).toEqual(['mgmt_fee']);
    expect(toTerms(card({ fee: '' })).charges).toEqual([]);
  });

  it('treats the opening balance as optional and turns purchases into installment plans with their own rate', () => {
    expect(toTerms(card({}, { principal: '' })).principalMinor).toBe(0);
    const terms = toTerms(card({ deferred: [NEVERA, { label: ' ', amount: '300000', n: '3', rate: '28' }] }));
    expect(terms.card.deferred).toEqual([
      expect.objectContaining({ id: 'p1', label: 'Nevera', principalMinor: 1200000, n: 12, rate: expect.objectContaining({ value: 0 }) }),
      expect.objectContaining({ id: 'p2', label: 'Compra 2', principalMinor: 300000, n: 3, rate: expect.objectContaining({ value: 28 }) }),
    ]);
  });

  it('produces terms the card projector bills as the statement fixture does', () => {
    const result = evaluate(card({ deferred: [NEVERA] }));
    const projection = project({ terms: result.terms }, [], '2026-10-20');

    expect(result.issues).toEqual([]);
    expect(result.summary).toBeNull();
    expect(projection.plan[0]).toMatchObject({ statementOn: '2026-10-15', interestMinor: 10392, principalMinor: 100000, chargesMinor: 9000, taxesMinor: 1710 });
  });

  it.each([
    ['a missing statement day', { statementDay: '' }, {}, 'card', 'missing'],
    ['a statement day of 40', { statementDay: '40' }, {}, 'card', 'message'],
    ['a purchase in one installment', { deferred: [{ ...NEVERA, n: '1' }] }, {}, 'card', 'message'],
    ['a negative opening balance', {}, { principal: '-5' }, 'basics', 'message'],
  ])('reports %s on the right step', (_label, patch, set, step, kind) => {
    const [issue] = evaluate(card(patch, set)).issues;

    expect(issue.step).toBe(step);
    if (kind === 'missing') expect(issue.missing).toBe(true);
    else expect(issue.message.length).toBeGreaterThan(10);
  });
});

describe('card wizard mora', () => {
  it('starts a card with the usury mora and carries it in the terms the review checks', () => {
    expect(card().late).toMatchObject({ mode: 'usury' });
    expect(toTerms(card()).late).toEqual({ mode: 'usury', graceDays: 0 });
    expect(evaluate(card()).terms.late).toEqual({ mode: 'usury', graceDays: 0 });
  });

  it('keeps the card without mora when it is switched off', () => {
    expect(toTerms({ ...card(), late: { ...card().late, mode: 'none' } }).late).toBeUndefined();
  });
});
