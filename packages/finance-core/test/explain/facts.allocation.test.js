// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { explainFacts } from '../../src/explain/explain.js';
import { DUE_ON, GOLDEN_LEGAL, TEN_DAYS_LATE, goldenDebt } from '../helpers/lateGolden.js';
import { reviewedCopy } from '../helpers/explainCopy.js';
import { pesosText } from '../../src/explain/format.js';
import { deepFreeze, ev, french, onTime } from '../helpers/loans.js';

const copy = reviewedCopy();
const facts = (row, today, opts = {}, events = []) => explainFacts('payment_allocation', row, events, GOLDEN_LEGAL, today, { copy, ...opts });
const split = ({ numbers }) => [numbers.charges, numbers.late, numbers.interest, numbers.principal];

describe('explain facts: payment_allocation', () => {
  it('splits 100,000 on the due date into charges 10,000, interest 90,000 and principal 0', () => {
    const result = facts(goldenDebt(), DUE_ON, { amountMinor: 100000 });

    expect(result).toMatchObject({ status: 'ok', dataSource: 'debt' });
    expect(split(result)).toEqual([10000, 0, 90000, 0]);
    expect(result.numbers).toMatchObject({ payment: 100000, taxes: 0, surplus: 0 });
    expect(result.text).toMatchObject({ payment: '$ 100.000', charges: '$ 10.000', late: '$ 0', interest: '$ 90.000', principal: '$ 0', paidOn: '15 de febrero de 2026', amountSource: 'stated' });
  });

  it('puts the mora before the interest when the installment is 10 days overdue: 10,000 / 1,375 / 88,625 / 0', () => {
    const result = facts(goldenDebt(), TEN_DAYS_LATE, { amountMinor: 100000 });

    expect(split(result)).toEqual([10000, 1375, 88625, 0]);
    expect(result.text.late).toBe('$ 1.375');
  });

  it('splits a payment of the whole installment on day 10: 10,000 / 1,375 / 180,876 / 198,130', () => {
    expect(split(facts(goldenDebt(), TEN_DAYS_LATE, { amountMinor: 390381 }))).toEqual([10000, 1375, 180876, 198130]);
  });

  it('uses what is due on the next installment, mora included, when no amount is stated', () => {
    const result = facts(goldenDebt(), TEN_DAYS_LATE);

    expect(result.numbers.payment).toBe(391756);
    expect(split(result)).toEqual([10000, 1375, 180876, 199505]);
    expect(result.text.amountSource).toBe('next_due');
  });

  it('carries what a payment leaves over the installment to the next one (its charges first), with no surplus', () => {
    const result = facts(goldenDebt(), DUE_ON, { amountMinor: 400381 });

    expect(split(result)).toEqual([20000, 0, 180876, 199505]);
    expect(result.numbers.surplus).toBe(0);
  });

  it('reports the surplus of a payment above everything the debt still owes', () => {
    const terms = french({ n: 2 });
    const result = facts(goldenDebt(terms), DUE_ON, { amountMinor: 11000000 });

    expect(result.numbers.surplus).toBeGreaterThan(0);
    expect(result.text.surplus).toBe(pesosText(result.numbers.surplus));
  });

  it('leaves less to allocate when an earlier payment already covered part of the installment', () => {
    const result = facts(goldenDebt(), DUE_ON, { amountMinor: 100000 }, [ev('payment', DUE_ON, 100000, {}, 'p1')]);

    expect(split(result)).toEqual([0, 0, 90876, 9124]);
  });

  it('says nothing is due, with no split, when no amount is stated and the debt is paid off', () => {
    const terms = french({ n: 2 });
    const result = facts(goldenDebt(terms), '2026-04-01', {}, onTime(terms, 2));

    expect(result.status).toBe('ok');
    expect(result.notices).toEqual([{ code: 'nothing_due' }]);
    expect(result.numbers).toEqual({});
  });

  it('is generic with no figures when there is no debt', () => {
    expect(facts(null, DUE_ON, { amountMinor: 100000 })).toMatchObject({ status: 'generic', dataSource: 'generic', numbers: {}, text: {} });
  });

  it('is a pure preview: frozen inputs and no event written', () => {
    const events = deepFreeze([]);

    expect(() => facts(deepFreeze(goldenDebt()), DUE_ON, { amountMinor: 100000 }, events)).not.toThrow();
    expect(events).toEqual([]);
  });
});
