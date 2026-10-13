// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { advise } from '../../src/advice/advice.js';
import { buildFacts, renderSummary } from '../../src/advice/facts.js';
import { compareStrategies } from '../../src/prepay/compare.js';
import { EA, debt, deepFreeze, ev, french, interestFree, onTime } from '../helpers/loans.js';

// DPA-3: `facts` carries every number the reply may show, as raw values and as
// pre-formatted text, plus a reason code per signal, so a paraphrase can be validated against it.

const compare = (terms, payments = onTime(terms, 12), on = '2027-01-20', amountMinor = 2_000_000) =>
  compareStrategies(debt(terms), payments, { amountMinor, on });
const loan = compare(french({ rate: EA(18) }));
const family = compare(interestFree(), [ev('payment', '2026-02-15', 100_000, {}, 'p1')], '2026-03-01', 300_000);
const card = { id: 'card', name: 'Tarjeta', eaPercent: 35 };
const comfortable = { avgIncomeMinor: 5_000_000, avgExpenseMinor: 3_000_000 };

const tokens = (text) => text.match(/\d+(?:[.,]\d+)*/g) ?? [];
// Numbers shown by the summary that no facts value contains.
const missing = (summary, facts) => {
  const known = new Set(tokens(JSON.stringify(facts)));
  return tokens(summary).filter((token) => !known.has(token));
};

const scenarios = {
  'default reduce term': advise(loan, comfortable),
  'tight margin': advise(loan, { avgIncomeMinor: 5_000_000, avgExpenseMinor: 4_800_000, otherDebts: [card] }),
  'installment ratio': advise(loan, { avgIncomeMinor: 1_000_000, avgExpenseMinor: 400_000 }),
  avalanche: advise(loan, { ...comfortable, otherDebts: [card] }),
  'zero rate with a higher-rate debt': advise(family, { ...comfortable, otherDebts: [card] }),
  payoff: advise(compare(french({ rate: EA(18) }), onTime(french({ rate: EA(18) }), 12), '2027-01-20', 50_000_000), comfortable),
  'penalty and unknown cash flow': advise(compare(french({ rate: EA(18), prepaymentPenaltyPct: 2 })), {}),
  mortgage: advise(compare(french({ kind: 'mortgage' })), comfortable),
};

describe('buildFacts', () => {
  it('exposes raw numbers and pre-formatted text for the comparison', () => {
    const { facts } = scenarios['default reduce term'];
    expect(facts).toMatchObject({ asOf: '2027-01-20', verdict: 'reduce_term', claimsSavings: true, identical: false });
    expect(facts.numbers).toMatchObject({ amount: 2_000_000, installment: loan.reduceTerm.before.installmentMinor, 'reduceTerm.installment': loan.reduceTerm.after.installmentMinor });
    expect(facts.numbers['reduceTerm.interestSaved']).toBe(loan.reduceTerm.savings.interestMinor);
    expect(facts.text).toMatchObject({ amount: '2.000.000', ea: '18%', 'reduceTerm.installment': '354.868', marginShare: '40%', 'reduceTerm.lastDueOn': loan.reduceTerm.after.lastDueOn });
    expect(facts.text['reduceInstallment.installment']).toBe(String(loan.reduceInstallment.after.installmentMinor).replace(/\B(?=(\d{3})+$)/g, '.'));
  });

  it('carries one reason code per signal that holds', () => {
    expect(scenarios['default reduce term'].facts.reasonCodes).toEqual(['default']);
    expect(scenarios['tight margin'].facts.reasonCodes).toEqual(['tight_margin', 'higher_rate_debt']);
    expect(scenarios['installment ratio'].facts.reasonCodes).toEqual(['installment_ratio']);
    expect(scenarios['zero rate with a higher-rate debt'].facts.reasonCodes).toEqual(['zero_rate', 'higher_rate_debt']);
    expect(scenarios['penalty and unknown cash flow'].facts.reasonCodes).toEqual(['default', 'cashflow_unknown']);
  });

  it('names the target debt and its rate for avalanche', () => {
    const { facts } = scenarios.avalanche;
    expect(facts.targetDebt).toEqual({ id: 'card', name: 'Tarjeta' });
    expect(facts.text['higherRate.ea']).toBe('35%');
  });

  it('keeps the legal notice, with asOf and the unverified scope, outside the numbers', () => {
    const { facts } = scenarios.mortgage;
    expect(facts.notices).toHaveLength(1);
    expect(facts.notices[0]).toMatchObject({ code: 'ley1555_scope_unverified', asOf: '2027-01-20' });
    expect(facts.notices[0].message).toMatch(/unverified/);
    expect(scenarios['default reduce term'].facts.notices).toEqual([]);
  });

  it('is attached to the advice, deterministic and free of side effects', () => {
    const frozen = deepFreeze(advise(loan, comfortable));
    const { facts, ...rest } = frozen;
    expect(buildFacts(rest)).toEqual(facts);
    expect(JSON.stringify(buildFacts(rest))).toBe(JSON.stringify(facts));
  });
});

describe('renderSummary', () => {
  it.each(Object.keys(scenarios))('shows only numbers that are in facts: %s', (name) => {
    const { facts } = scenarios[name];
    const summary = renderSummary(facts);
    expect(tokens(summary).length).toBeGreaterThan(4);
    expect(missing(summary, facts)).toEqual([]);
  });

  it('the completeness check catches a number that facts does not hold', () => {
    const { facts } = scenarios['default reduce term'];
    expect(missing(`${renderSummary(facts)} Save 42% more.`, facts)).toEqual(['42']);
  });

  it('states the verdict, and for 0% claims no savings', () => {
    expect(renderSummary(scenarios['default reduce term'].facts)).toMatch(/reduce the term/i);
    expect(renderSummary(scenarios['tight margin'].facts)).toMatch(/reduce the installment/i);
    expect(renderSummary(scenarios.avalanche.facts)).toMatch(/Tarjeta first/);
    const zero = renderSummary(scenarios['zero rate with a higher-rate debt'].facts);
    expect(zero).toMatch(/liquidity/);
    expect(zero).not.toMatch(/sav(ed|es|ing)/);
  });

  it('mentions a full payoff and a penalty only when they apply', () => {
    expect(renderSummary(scenarios.payoff.facts)).toMatch(/paid off/);
    expect(renderSummary(scenarios['default reduce term'].facts)).not.toMatch(/paid off|penalty/);
    expect(renderSummary(scenarios['penalty and unknown cash flow'].facts)).toMatch(/penalty 2%/);
  });
});
