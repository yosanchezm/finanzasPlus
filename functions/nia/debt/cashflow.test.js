// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ADVICE_DEFAULTS, advise, compareStrategies, serializeTerms } from '../../../packages/finance-core/index.js';
import { averageCashflow, cashflowSignals, cashflowWindow, inScopeFor, parseThresholds } from './cashflow.js';

const TZ = 'America/Bogota';
const TODAY = '2026-10-13';
const row = (type, amountMinor, occurredAt, ownerScope = 'shared') => ({ type, amountMinor, occurredAt, ownerScope });

// July, August and September (the 3 full months before October); the current month and June must not count.
const quarter = (income, expense) => [
  row('income', income, '2026-07-15T15:00:00.000Z'),
  row('income', income, '2026-08-15T15:00:00.000Z'),
  row('income', income, '2026-09-15T15:00:00.000Z'),
  row('expense', expense, '2026-07-20T15:00:00.000Z'),
  row('expense', expense, '2026-08-20T15:00:00.000Z'),
  row('expense', expense, '2026-09-20T15:00:00.000Z'),
];

describe('cashflowWindow', () => {
  it('covers the 3 full months before the current one in every time zone offset', () => {
    const { from, to } = cashflowWindow(TODAY);

    expect(from <= '2026-06-30T00:00:00.000Z').toBe(true);
    expect(from >= '2026-06-29T00:00:00.000Z').toBe(true);
    expect(to >= '2026-10-02T00:00:00.000Z').toBe(true);
    expect(to <= '2026-10-03T00:00:00.000Z').toBe(true);
    expect(cashflowWindow('2026-01-05').from.slice(0, 10)).toBe('2025-09-30');
  });
});

describe('averageCashflow', () => {
  it('averages 3 full months and leaves the current month and the month before them out', () => {
    const rows = [...quarter(6000000, 4200000), row('income', 9000000, '2026-10-02T15:00:00.000Z'), row('expense', 9000000, '2026-06-20T15:00:00.000Z')];

    expect(averageCashflow(rows, TODAY, { timezone: TZ })).toEqual({ avgIncomeMinor: 6000000, avgExpenseMinor: 4200000 });
  });

  it('assigns a month with the household time zone, not UTC', () => {
    const rows = [
      row('income', 3000000, '2026-10-01T03:00:00.000Z'), // 22:00 of Sep 30 in Bogotá: September
      row('income', 3000000, '2026-07-01T03:00:00.000Z'), // 22:00 of Jun 30 in Bogotá: June, out
      row('income', 3000000, '2026-07-01T06:00:00.000Z'), // 01:00 of Jul 1: July
    ];

    expect(averageCashflow(rows, TODAY, { timezone: TZ })).toEqual({ avgIncomeMinor: 2000000, avgExpenseMinor: 0 });
  });

  it('rounds the average and ignores transfers and unreadable dates', () => {
    const rows = [row('income', 1000000, '2026-07-15T15:00:00Z'), row('income', 1, '2026-08-15T15:00:00Z'), row('transfer', 5000000, '2026-08-15T15:00:00Z'), row('income', 5000000, 'not a date')];

    expect(averageCashflow(rows, TODAY, { timezone: TZ })).toEqual({ avgIncomeMinor: 333334, avgExpenseMinor: 0 });
  });

  it('is unknown (null) with no income, however large the expenses', () => {
    expect(averageCashflow([], TODAY, { timezone: TZ })).toBeNull();
    expect(averageCashflow([row('expense', 900000, '2026-08-15T15:00:00Z')], TODAY, { timezone: TZ })).toBeNull();
  });

  it('only counts the rows of the scope', () => {
    const rows = [...quarter(6000000, 4000000), row('income', 6000000, '2026-08-01T15:00:00Z', 'partner')];

    expect(averageCashflow(rows, TODAY, { timezone: TZ, inScope: inScopeFor('you') })).toEqual({ avgIncomeMinor: 6000000, avgExpenseMinor: 4000000 });
    expect(averageCashflow(rows, TODAY, { timezone: TZ, inScope: inScopeFor('shared') }).avgIncomeMinor).toBe(8000000);
  });
});

describe('inScopeFor', () => {
  it('shows a personal debt its owner and the shared rows, and a shared debt everything', () => {
    expect(['you', 'partner', 'shared'].filter((scope) => inScopeFor('you')({ ownerScope: scope }))).toEqual(['you', 'shared']);
    expect(['you', 'partner', 'shared'].filter((scope) => inScopeFor('shared')({ ownerScope: scope }))).toEqual(['you', 'partner', 'shared']);
  });
});

// A 10,000,000 French loan at 24% EA (first installment 380,381) and the real advice on top of the signals.
const loan = { $id: 'd1', name: 'Crédito', kind: 'consumer', ownerScope: 'you', status: 'active', termsJson: serializeTerms({ kind: 'consumer', principalMinor: 10000000, openedOn: '2026-09-10', rate: { convention: 'EA', value: 24 }, system: 'french', periodicity: 'monthly', n: 36, firstDueOn: '2026-10-10' }) };
const loanEvents = [{ $id: 'e1', debtId: 'd1', kind: 'disbursement', effectiveOn: '2026-09-10', amountMinor: 10000000, payloadJson: '{}', $createdAt: '2026-09-10T12:00:00.000Z' }];
const comparison = compareStrategies(loan, loanEvents, { amountMinor: 1000000, on: TODAY });
const adviceFor = (rows, otherDebts = [], thresholds = {}, installmentMinor) => advise(comparison, cashflowSignals({ rows, today: TODAY, timezone: TZ, otherDebts, installmentMinor }), thresholds);

describe('cashflowSignals feeding the core advice', () => {
  it('a comfortable margin and no pricier debt gives the default verdict with the figures', () => {
    const advice = adviceFor(quarter(6000000, 3000000));

    expect(advice.verdict).toBe('reduce_term');
    expect(advice.signals).toMatchObject({ avgIncomeMinor: 6000000, avgExpenseMinor: 3000000, marginMinor: 3000000, tightMargin: false, higherRateDebt: false });
    expect(advice.signals.marginRatio).toBeCloseTo(0.5, 10);
    expect(advice.signals.installmentToIncome).toBeCloseTo(380381 / 6000000, 10);
  });

  it('a margin under the threshold is a tight margin and cites it', () => {
    const advice = adviceFor(quarter(6000000, 5700000));

    expect(advice.verdict).toBe('reduce_installment');
    expect(advice.reasons.map((reason) => reason.code)).toEqual(['tight_margin']);
    expect(advice.facts.text.margin).toBe('300.000');
  });

  it('an installment above 30% of the income is tight even with a margin, and a given installment replaces the plan one', () => {
    expect(adviceFor(quarter(1000000, 100000), [], {}, 380381).signals).toMatchObject({ tightMargin: true, installmentAbove: true, marginBelow: false });
    expect(adviceFor(quarter(1000000, 100000), [], {}, 200000).signals.tightMargin).toBe(false);
  });

  it('a debt with a strictly higher EA wins over the default; the gap threshold can silence it', () => {
    const pricier = [{ id: 'd2', name: 'Tarjeta', eaPercent: 24.5 }];

    expect(adviceFor(quarter(6000000, 3000000), pricier).verdict).toBe('avalanche');
    expect(adviceFor(quarter(6000000, 3000000), [{ id: 'd2', name: 'Tarjeta', eaPercent: 24 }]).verdict).toBe('reduce_term');
    expect(adviceFor(quarter(6000000, 3000000), pricier, { higherRateGapPct: 1 }).verdict).toBe('reduce_term');
  });

  it('both signals: liquidity wins and the pricier debt stays among the reasons', () => {
    const advice = adviceFor(quarter(6000000, 5700000), [{ id: 'd2', name: 'Tarjeta', eaPercent: 35 }]);

    expect(advice.verdict).toBe('reduce_installment');
    expect(advice.reasons.map((reason) => reason.code)).toEqual(['tight_margin', 'higher_rate_debt']);
  });

  it('unknown cash flow is reported, never guessed', () => {
    const advice = adviceFor([row('expense', 800000, '2026-08-15T15:00:00Z')]);

    expect(advice.signals.tightMargin).toBeNull();
    expect(advice.reasons.map((reason) => reason.code)).toContain('cashflow_unknown');
    expect(advice.verdict).toBe('reduce_term');
  });
});

describe('parseThresholds', () => {
  it('reads the known thresholds from the env JSON and drops anything else', () => {
    expect(parseThresholds('{"tightMarginRatio":0.2,"maxInstallmentToIncome":0.4,"higherRateGapPct":2}')).toEqual({ tightMarginRatio: 0.2, maxInstallmentToIncome: 0.4, higherRateGapPct: 2 });
    expect(parseThresholds('{"tightMarginRatio":0.2,"colour":"red","maxInstallmentToIncome":-1,"higherRateGapPct":"3"}')).toEqual({ tightMarginRatio: 0.2 });
  });

  it('falls back to the defaults (an empty override) on invalid JSON or a non-object', () => {
    for (const value of [undefined, '', '{not json', '[]', '7', 'null', '"text"']) expect(parseThresholds(value)).toEqual({});
  });

  it('feeds the core: an override moves the verdict, defaults stay the core defaults', () => {
    const rows = quarter(6000000, 5000000); // margin 16.7%: fine by default, tight at 20%

    expect(adviceFor(rows, [], parseThresholds('{"tightMarginRatio":0.2}')).verdict).toBe('reduce_installment');
    expect(adviceFor(rows, [], parseThresholds('{oops')).verdict).toBe('reduce_term');
    expect(adviceFor(rows, [], parseThresholds('{oops')).thresholds).toEqual(ADVICE_DEFAULTS);
  });
});
