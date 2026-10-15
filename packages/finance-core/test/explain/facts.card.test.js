// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { explainFacts } from '../../src/explain/explain.js';
import { GOLDEN_LEGAL } from '../helpers/lateGolden.js';
import { reviewedCopy } from '../helpers/explainCopy.js';
import { deepFreeze } from '../helpers/loans.js';

// Facts of the card topics (spec: Card topics). Goldens come from the independent card fixture: statement 1 of 121,102
// (interest 10,392, fee and IVA 10,710, installment 100,000), minimum 146,102, which leaves 125,000 of capital unmet.
const fixture = JSON.parse(readFileSync(new URL('../fixtures/card-statement-independent.json', import.meta.url), 'utf8'));
const copy = reviewedCopy();

const card = (terms = fixture.terms) => ({ $id: 'c1', householdId: 'h1', name: 'Visa', ownerScope: 'shared', terms });
const plainTerms = (principalMinor, statementDay = 15, dueDay = 30) => ({
  ...fixture.terms,
  principalMinor,
  charges: [],
  card: { ...fixture.terms.card, deferred: [], statementDay, dueDay },
});
// Statement on the 20th and due on the 10th of the next month, mora at the usury cap: the F3 golden.
const moraTerms = (late = { mode: 'usury', graceDays: 0 }) => ({ ...fixture.terms, late, card: { ...fixture.terms.card, statementDay: 20, dueDay: 10 } });
let counter = 0;
const pay = (effectiveOn, amountMinor, $id = `p${(counter += 1)}`) => ({
  $id,
  debtId: 'c1',
  kind: 'payment',
  effectiveOn,
  amountMinor,
  payloadJson: '{}',
  $createdAt: '2026-01-01T00:00:00.000Z',
});
const topic = (name, row, today, events = [], opts = {}) => explainFacts(name, row, events, GOLDEN_LEGAL, today, { copy, ...opts });
const codes = (result) => result.notices.map((notice) => notice.code);

describe('explain facts: card_statement', () => {
  it('shows the last statement, its minimum payment and the minimum rule from the core', () => {
    const result = topic('card_statement', card(), '2026-04-20');

    expect(result).toMatchObject({ status: 'ok', dataSource: 'debt', debt: { id: 'c1', kind: 'card' } });
    expect(result.numbers).toMatchObject({ total: 121_102, interest: 10_392, installments: 100_000, charges: 10_710, late: 0, payInFull: 621_102, minimum: 146_102, paid: 0, outstanding: 146_102, pct: 5, floor: 20_000 });
    expect(result.text).toMatchObject({
      statementOn: '15 de abril de 2026',
      dueOn: '30 de abril de 2026',
      total: '$ 121.102',
      interest: '$ 10.392',
      installments: '$ 100.000',
      charges: '$ 10.710',
      payInFull: '$ 621.102',
      minimum: '$ 146.102',
      outstanding: '$ 146.102',
      rule: 'interest_fees_plus_pct',
      pct: '5 %',
      floor: '$ 20.000',
      nextStatementOn: '15 de mayo de 2026',
      nextDueOn: '30 de mayo de 2026',
      status: 'due',
    });
    expect(result.approximate).toEqual([]);
  });

  it('shows what a payment already covered of the minimum', () => {
    const result = topic('card_statement', card(), '2026-04-26', [pay('2026-04-25', 100_000)]);

    expect(result.numbers).toMatchObject({ minimum: 146_102, paid: 100_000, outstanding: 46_102 });
    expect(result.text.status).toBe('partial');
  });

  it('names the other minimum rules with the minimum the core computes for each', () => {
    const rule = (name, pct) => ({ ...fixture.terms, card: { ...fixture.terms.card, minPayment: { rule: name, pct, floorMinor: 0 } } });
    const installments = topic('card_statement', card(rule('installments_due', 0)), '2026-04-20');
    const balance = topic('card_statement', card(rule('pct_balance', 10)), '2026-04-20');

    expect(installments.text.rule).toBe('installments_due');
    expect(installments.numbers.minimum).toBe(fixture.statement1.minimumByRule.installments_due);
    expect(balance.text).toMatchObject({ rule: 'pct_balance', pct: '10 %' });
    expect(balance.numbers.minimum).toBe(fixture.statement1.minimumByRule.pct_balance_10);
  });

  it('gives only the rule and the next statement before the first cut-off date', () => {
    const result = topic('card_statement', card(), '2026-04-10');

    expect(result.status).toBe('ok');
    expect(codes(result)).toEqual(['no_statement_yet']);
    expect(result.numbers.total).toBeUndefined();
    expect(result.text).toMatchObject({ rule: 'interest_fees_plus_pct', pct: '5 %', nextStatementOn: '15 de abril de 2026' });
  });

  it('answers generically with no figures when there is no card, and not applicable for a loan', () => {
    expect(topic('card_statement', null, '2026-04-20')).toMatchObject({ status: 'generic', dataSource: 'generic', numbers: {}, text: {} });
    const loan = { $id: 'd1', householdId: 'h1', name: 'Credito', ownerScope: 'shared', terms: { kind: 'consumer', principalMinor: 1_000_000, openedOn: '2026-01-15', rate: fixture.terms.rate, system: 'french', periodicity: 'monthly', n: 12, firstDueOn: '2026-02-15' } };
    expect(topic('card_statement', loan, '2026-04-20')).toMatchObject({ status: 'not_applicable', numbers: {}, text: {} });
  });
});

describe('explain facts: card_interest_drop', () => {
  it('shows the revolving and excluded base of the first statement and the minimum-only what-if from the core', () => {
    const result = topic('card_interest_drop', card(), '2026-04-20');
    const { paymentMinor, revolvingMinor, interestMinor } = fixture.afterMinimum;

    expect(result).toMatchObject({ status: 'ok', dataSource: 'debt', debt: { kind: 'card' } });
    expect(result.numbers).toMatchObject({ interest: 10_392, revolving: 500_000, excluded: 0, lateExcluded: 0 });
    expect(result.numbers.previousInterest).toBeUndefined();
    expect(result.text).toMatchObject({ statementOn: '15 de abril de 2026', interest: '$ 10.392', revolving: '$ 500.000', excluded: '$ 0', monthly: '2,08 %', ea: '28 %' });
    expect(codes(result)).toEqual(['first_cycle']);
    // Paying only the minimum on the due date leaves the rest of the capital to accrue interest at the next close.
    expect(result.numbers).toMatchObject({ minPayment: paymentMinor, fullPayment: 621_102, minBase: revolvingMinor, minInterest: interestMinor, fullBase: 0, fullInterest: 0, extra: interestMinor });
    expect(result.text).toMatchObject({ whatIfDueOn: '30 de abril de 2026', whatIfCloseOn: '15 de mayo de 2026', minPayment: '$ 146.102', minBase: '$ 475.000', minInterest: '$ 9.873', extra: '$ 9.873' });
    expect(result.approximate).toEqual(expect.arrayContaining(['revolving', 'interest', 'minBase', 'minInterest', 'extra']));
  });

  it('reports a statement paid in full by its due date as zero revolving base and zero interest', () => {
    const terms = plainTerms(800_000);
    const first = topic('card_interest_drop', card(terms), '2026-04-20');
    const events = [pay('2026-04-30', 800_000 + first.numbers.interest)];
    const result = topic('card_interest_drop', card(terms), '2026-05-20', events);

    expect(result.numbers).toMatchObject({ revolving: 0, excluded: 800_000, lateExcluded: 0, interest: 0, previousInterest: first.numbers.interest, drop: first.numbers.interest });
    expect(result.text).toMatchObject({ revolving: '$ 0', excluded: '$ 800.000', interest: '$ 0' });
    expect(codes(result)).toEqual(['paid_in_full']);
  });

  it('keeps the 300,000 still unpaid as the revolving base and the paid part as excluded', () => {
    const { paymentMinor, revolvingMinor, nextInterestMinor } = fixture.unpaid300k;
    const result = topic('card_interest_drop', card(), '2026-05-20', [pay('2026-04-28', paymentMinor)]);

    expect(result.numbers).toMatchObject({ revolving: revolvingMinor, excluded: 200_000, interest: nextInterestMinor, previousInterest: 10_392, drop: 10_392 - nextInterestMinor });
    expect(codes(result)).toEqual(['partly_paid']);
  });

  it('explains the drop from 10,392 to 9,526 when the mora replaces the interest on the unmet capital', () => {
    const result = topic('card_interest_drop', card(moraTerms()), '2026-05-20');

    expect(result.numbers).toMatchObject({ interest: 9_526, revolving: 458_333, lateExcluded: 41_667, excluded: 0, withoutLateInterest: 10_392, lateEffect: 866, previousInterest: 10_392, drop: 866 });
    expect(result.text).toMatchObject({ interest: '$ 9.526', lateExcluded: '$ 41.667', withoutLateInterest: '$ 10.392', lateEffect: '$ 866' });
    expect(codes(result)).toEqual(['mora_replaced']);
    expect(result.approximate).toEqual(expect.arrayContaining(['lateExcluded', 'revolving', 'withoutLateInterest', 'lateEffect']));
    // Without a mora policy the same card keeps the 10,392 and has nothing to explain.
    const none = topic('card_interest_drop', card(moraTerms({ mode: 'none', graceDays: 0 })), '2026-05-20');
    expect(none.numbers).toMatchObject({ interest: 10_392, lateExcluded: 0 });
    expect(none.numbers.lateEffect).toBeUndefined();
    expect(codes(none)).toEqual([]);
  });

  it('builds the what-if from the statement and ignores payments made after it', () => {
    const asked = topic('card_interest_drop', card(), '2026-04-20');
    const later = topic('card_interest_drop', card(), '2026-04-26', [pay('2026-04-25', 621_102)]);

    expect(later.numbers).toMatchObject({ minPayment: asked.numbers.minPayment, minInterest: asked.numbers.minInterest, minBase: asked.numbers.minBase });
  });

  it('has no figures before the first statement and is generic without a card', () => {
    const early = topic('card_interest_drop', card(), '2026-04-10');
    expect(codes(early)).toEqual(['no_statement_yet']);
    expect(early.numbers.interest).toBeUndefined();
    expect(topic('card_interest_drop', null, '2026-04-20')).toMatchObject({ status: 'generic', numbers: {}, text: {} });
  });

  it('does not change frozen inputs', () => {
    expect(() => explainFacts('card_interest_drop', deepFreeze(card()), deepFreeze([pay('2026-04-25', 100_000)]), GOLDEN_LEGAL, '2026-05-20', deepFreeze({ copy }))).not.toThrow();
    expect(() => explainFacts('card_statement', deepFreeze(card()), deepFreeze([]), GOLDEN_LEGAL, '2026-05-20', deepFreeze({ copy }))).not.toThrow();
  });
});
