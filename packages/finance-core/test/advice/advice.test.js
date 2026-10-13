// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ADVICE_DEFAULTS, advise } from '../../src/advice/advice.js';
import { compareStrategies } from '../../src/prepay/compare.js';
import { EA, debt, deepFreeze, ev, french, interestFree, onTime } from '../helpers/loans.js';

// DPA-2 and DPA-4: the deterministic verdict. First match wins:
// 0% -> liquidity_only; tight margin -> reduce_installment; higher-rate debt -> avalanche; else reduce_term.

const compare = (terms, payments = onTime(terms, 12), on = '2027-01-20', amountMinor = 2_000_000) =>
  deepFreeze(compareStrategies(debt(terms), payments, { amountMinor, on }));
const compareFamily = () => compare(interestFree(), [ev('payment', '2026-02-15', 100_000, {}, 'p1')], '2026-03-01', 300_000);
const loan = compare(french({ rate: EA(18) }));
const card = { id: 'card', name: 'Tarjeta', eaPercent: 35 };
const comfortable = { avgIncomeMinor: 5_000_000, avgExpenseMinor: 3_000_000 };
const codes = (advice) => advice.reasons.map((reason) => reason.code);

describe('ADVICE_DEFAULTS', () => {
  it('holds the documented thresholds and is frozen', () => {
    expect(ADVICE_DEFAULTS).toEqual({ tightMarginRatio: 0.1, maxInstallmentToIncome: 0.3, higherRateGapPct: 0 });
    expect(Object.isFrozen(ADVICE_DEFAULTS)).toBe(true);
  });
});

describe('advise: truth table', () => {
  it('defaults to reduce term with a comfortable margin and no higher-rate debt', () => {
    const advice = advise(loan, { ...comfortable, otherDebts: [{ id: 'cheap', name: 'Familiar', eaPercent: 5 }] });
    expect(advice).toMatchObject({ verdict: 'reduce_term', claimsSavings: true, targetDebt: null });
    expect(codes(advice)).toEqual(['default']);
    expect(advice.signals).toMatchObject({ tightMargin: false, higherRateDebt: false, marginMinor: 2_000_000, marginRatio: 0.4 });
  });

  it('a tight 3-month margin gives reduce installment and cites the margin', () => {
    const advice = advise(loan, { avgIncomeMinor: 5_000_000, avgExpenseMinor: 4_800_000 });
    expect(advice.verdict).toBe('reduce_installment');
    expect(advice.reasons[0]).toEqual({ code: 'tight_margin', marginMinor: 200_000, marginRatio: 0.04, thresholdRatio: 0.1 });
  });

  it('an installment above the income ratio gives reduce installment and cites the ratio', () => {
    const advice = advise(loan, { avgIncomeMinor: 1_000_000, avgExpenseMinor: 400_000 });
    expect(advice.verdict).toBe('reduce_installment');
    expect(codes(advice)).toEqual(['installment_ratio']);
    expect(advice.reasons[0].installmentToIncome).toBeCloseTo(0.38, 1);
  });

  it('a card at 35% EA against a loan at 18% EA gives avalanche and names the card', () => {
    const advice = advise(loan, { ...comfortable, otherDebts: [{ id: 'cheap', name: 'Familiar', eaPercent: 5 }, card] });
    expect(advice).toMatchObject({ verdict: 'avalanche', claimsSavings: true, targetDebt: card });
    expect(advice.reasons[0]).toMatchObject({ code: 'higher_rate_debt', debts: [card] });
  });

  it('a 0% debt is liquidity-only and claims no interest savings', () => {
    const family = compareFamily();
    const advice = advise(family, comfortable);
    expect(advice).toMatchObject({ verdict: 'liquidity_only', claimsSavings: false });
    expect(codes(advice)).toEqual(['zero_rate']);
    expect(family.reduceTerm.savings.interestMinor).toBe(0);
  });

  it('at 0% a higher-rate debt is still listed as a reason, and liquidity still decides', () => {
    const family = compareFamily();
    const advice = advise(family, { ...comfortable, otherDebts: [card] });
    expect(advice.verdict).toBe('liquidity_only');
    expect(codes(advice)).toEqual(['zero_rate', 'higher_rate_debt']);
  });

  it('a tight margin wins over a higher-rate debt, which stays in the reasons', () => {
    const advice = advise(loan, { avgIncomeMinor: 5_000_000, avgExpenseMinor: 4_800_000, otherDebts: [card] });
    expect(advice.verdict).toBe('reduce_installment');
    expect(codes(advice)).toEqual(['tight_margin', 'higher_rate_debt']);
  });

  it('without cash-flow figures the margin is unknown, not tight', () => {
    const advice = advise(loan, {});
    expect(advice.verdict).toBe('reduce_term');
    expect(advice.signals.tightMargin).toBeNull();
    expect(codes(advice)).toEqual(['default', 'cashflow_unknown']);
  });

  it('flags that both strategies are the same when the system keeps its term', () => {
    const german = french({ system: 'german', n: 24 });
    const advice = advise(compare(german, onTime(german, 6), '2026-08-01'), comfortable);
    expect(codes(advice)).toEqual(['default', 'strategies_identical']);
  });
});

describe('advise: thresholds', () => {
  it('a gap of 0 means strictly higher: the same EA is not a higher-rate debt', () => {
    const same = { id: 'same', name: 'Gemelo', eaPercent: loan.eaPercent };
    expect(advise(loan, { ...comfortable, otherDebts: [same] }).signals.higherRateDebt).toBe(false);
    expect(advise(loan, { ...comfortable, otherDebts: [{ ...same, eaPercent: loan.eaPercent + 0.01 }] }).signals.higherRateDebt).toBe(true);
  });

  it('is configurable: the gap, the margin ratio and the installment ratio', () => {
    const wide = advise(loan, { ...comfortable, otherDebts: [{ id: 'x', name: 'X', eaPercent: 20 }] }, { higherRateGapPct: 5 });
    expect(wide.signals.higherRateDebt).toBe(false);
    expect(advise(loan, { ...comfortable, otherDebts: [{ id: 'x', name: 'X', eaPercent: 24 }] }, { higherRateGapPct: 5 }).verdict).toBe('avalanche');
    expect(advise(loan, comfortable, { tightMarginRatio: 0.5 }).verdict).toBe('reduce_installment');
    expect(advise(loan, comfortable, { maxInstallmentToIncome: 0.05 }).reasons[0].code).toBe('installment_ratio');
    expect(advise(loan, comfortable, { tightMarginRatio: 0.4 }).verdict).toBe('reduce_term'); // exactly at the threshold is not below it
  });

  it('rejects invalid thresholds with a typed error', () => {
    expect(() => advise(loan, comfortable, { tightMarginRatio: -1 })).toThrow(/tightMarginRatio/);
    expect(() => advise(loan, comfortable, { higherRateGapPct: 'wide' })).toThrow(/higherRateGapPct/);
  });
});

describe('advise: Ley 1555 notice (DPA-4)', () => {
  it('a mortgage gets the notice with asOf and scope unverified, and the simulation is untouched', () => {
    const mortgage = compare(french({ kind: 'mortgage' }));
    const advice = advise(mortgage, comfortable);
    expect(advice.notices).toHaveLength(1);
    expect(advice.notices[0]).toMatchObject({ code: 'ley1555_scope_unverified', asOf: '2027-01-20', scopeVerified: false, blocking: false });
    expect(advice.comparison).toBe(mortgage);
    expect(advice.verdict).toBe('reduce_term');
  });

  it('a consumer loan has no notice', () => {
    expect(advise(loan, comfortable).notices).toEqual([]);
  });
});
