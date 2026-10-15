// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EXPLAIN_COPY } from '../../src/explain/copy.js';
import { explainFacts } from '../../src/explain/explain.js';
import { restructureCarry } from '../../src/ledger/restructure.js';
import { DUE_ON, GOLDEN_LEGAL, GOLDEN_TERMS, TEN_DAYS_LATE, goldenDebt } from '../helpers/lateGolden.js';
import { debt, deepFreeze, french, interestFree, ev } from '../helpers/loans.js';
import { reviewedCopy } from '../helpers/explainCopy.js';

const copy = reviewedCopy();
const facts = (row, today, events = [], opts = {}, legal = GOLDEN_LEGAL) => explainFacts('restructure_whatif', row, events, legal, today, { copy, ...opts });
const codes = (result) => result.notices.map((notice) => notice.code);
const CARD = { $id: 'c1', householdId: 'h1', name: 'Visa', ownerScope: 'shared', terms: { ...french(), kind: 'card', card: { statementDay: 20, dueDay: 10, minPayment: { rule: 'installments_due', pct: 0, floorMinor: 0 } } } };

describe('explain facts: restructure_whatif', () => {
  it('golden: an installment of 390,381 unpaid for 10 days at 28.59 % EA refinances 391,756, or 390,381 waiving the mora', () => {
    const result = facts(goldenDebt(), TEN_DAYS_LATE);

    expect(result).toMatchObject({ status: 'ok', dataSource: 'debt', debt: { kind: 'loan' } });
    expect(result.numbers).toEqual({
      balance: 10_000_000,
      interest: 180_876,
      charges: 10_000,
      taxes: 0,
      late: 1375,
      refinanced: 391_756,
      refinancedWaived: 390_381,
      newBalance: 10_192_251,
      newBalanceWaived: 10_190_876,
    });
    expect(result.text).toMatchObject({
      balance: '$ 10.000.000',
      interest: '$ 180.876',
      charges: '$ 10.000',
      late: '$ 1.375',
      refinanced: '$ 391.756',
      refinancedWaived: '$ 390.381',
      newBalance: '$ 10.192.251',
      newBalanceWaived: '$ 10.190.876',
      asOf: '25 de febrero de 2026',
    });
    expect(result.approximate).toEqual([]);
    expect(codes(result)).toEqual([]);
    expect(result.copyKeys).toEqual(['restructure_whatif.sample']);
  });

  it('agrees with the core carry and the projection it is built from', () => {
    const carry = restructureCarry({ ...goldenDebt(), legal: GOLDEN_LEGAL }, [], TEN_DAYS_LATE);
    const result = facts(goldenDebt(), TEN_DAYS_LATE);

    expect(result.numbers.newBalance).toBe(carry.carriedMinor);
    expect(result.numbers.newBalance - result.numbers.newBalanceWaived).toBe(carry.waivableLateMinor);
    expect(result.numbers.refinanced - result.numbers.refinancedWaived).toBe(carry.waivableLateMinor);
  });

  it('keeps the same figures as the golden after the mora is waived and says nothing waivable when mora is off', () => {
    const noLate = facts(debt({ ...GOLDEN_TERMS, late: { mode: 'none' } }), TEN_DAYS_LATE);

    expect(noLate.numbers).toMatchObject({ late: 0, refinanced: 390_381, refinancedWaived: 390_381, newBalance: 10_190_876, newBalanceWaived: 10_190_876 });
    expect(codes(noLate)).toEqual(['no_late']);
  });

  it('reads a 0 % family loan that is behind: nothing to waive, the unpaid installment is refinanced', () => {
    const result = facts(debt(interestFree()), '2026-02-20', [], {}, null);

    expect(result.numbers).toMatchObject({ balance: 1_200_000, interest: 0, late: 0, refinanced: 100_000, newBalance: 1_200_000 });
    expect(codes(result)).toEqual(['no_late']);
  });

  it('says nothing is overdue before the first due date and keeps the balance as the new principal', () => {
    const result = facts(goldenDebt(), '2026-02-10');

    expect(result.status).toBe('ok');
    expect(result.numbers).toMatchObject({ refinanced: 0, refinancedWaived: 0, newBalance: 10_000_000, newBalanceWaived: 10_000_000 });
    expect(codes(result)).toEqual(['nothing_overdue']);
  });

  it('reflects a payment of the first installment: the carry is only the balance', () => {
    const paid = [ev('payment', DUE_ON, 390_381, {}, 'p1')];
    const result = facts(goldenDebt(), TEN_DAYS_LATE, paid);

    expect(result.numbers).toMatchObject({ late: 0, refinanced: 0, newBalance: 9_800_495 });
    expect(codes(result)).toEqual(['nothing_overdue']);
  });

  it('flags a mortgage with mora: the rules of housing credit are not applied', () => {
    const result = facts(debt({ ...GOLDEN_TERMS, kind: 'mortgage' }), TEN_DAYS_LATE);

    expect(result.status).toBe('ok');
    expect(result.numbers.late).toBeGreaterThan(0);
    expect(codes(result)).toContain('late_mortgage_unverified');
  });

  it('is generic with no figures when there is no debt', () => {
    const result = facts(null, TEN_DAYS_LATE);

    expect(result).toMatchObject({ status: 'generic', dataSource: 'generic', debt: null, numbers: {}, text: {} });
    expect(result.copy).toHaveLength(1);
  });

  it('does not apply to a card and shows no figure', () => {
    const result = facts(CARD, TEN_DAYS_LATE);

    expect(result).toMatchObject({ status: 'not_applicable', numbers: {}, text: {} });
  });

  it('is under review while its copy is not reviewed', () => {
    const unreviewed = Object.fromEntries(Object.entries(EXPLAIN_COPY).map(([key, entry]) => [key, { ...entry, reviewedOn: null, reviewedHash: null }]));
    const result = explainFacts('restructure_whatif', goldenDebt(), [], GOLDEN_LEGAL, TEN_DAYS_LATE, { copy: unreviewed });

    expect(result.status).toBe('under_review');
    expect(result.numbers).toEqual({});
  });

  it('does not mutate its inputs', () => {
    const row = deepFreeze(goldenDebt());
    const events = deepFreeze([ev('payment', DUE_ON, 100_000, {}, 'p2')]);
    const before = JSON.stringify([row, events]);

    facts(row, TEN_DAYS_LATE, events);

    expect(JSON.stringify([row, events])).toBe(before);
  });
});
