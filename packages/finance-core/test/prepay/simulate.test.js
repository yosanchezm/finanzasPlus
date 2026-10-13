// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { simulateExtra } from '../../src/prepay/simulate.js';
import { debt, deepFreeze, french, interestFree, onTime, ev } from '../helpers/loans.js';

// DPA-1: strategy simulation. Pure: it replays project() with a hypothetical
// extra_payment and never touches the inputs.

const STRATEGIES = ['reduce_term', 'reduce_installment', 'advance_installments'];
const paidOne = [ev('payment', '2026-02-15', 100_000, {}, 'p1')];
const zero = (strategy, amountMinor = 300_000) => simulateExtra(debt(interestFree()), paidOne, { amountMinor, strategy, on: '2026-03-01' });

describe('simulateExtra on an interest-free loan (1,200,000 x 12, one installment paid, +300,000)', () => {
  it('reduce term: 8 installments of 100,000 and nothing saved', () => {
    const result = zero('reduce_term');
    expect(result.before).toMatchObject({ balanceMinor: 1_100_000, remainingPeriods: 11, installmentMinor: 100_000 });
    expect(result.after).toMatchObject({ balanceMinor: 800_000, remainingPeriods: 8, installmentMinor: 100_000, lastDueOn: '2026-10-15' });
    expect(result.savings).toEqual({ interestMinor: 0, chargesMinor: 0 });
    expect(result).toMatchObject({ strategy: 'reduce_term', eaPercent: 0, appliedMinor: 300_000, extraPrincipalMinor: 300_000, surplusMinor: 0, paidOff: false });
  });

  it('reduce installment: 11 installments of about 72,727 and nothing saved', () => {
    const result = zero('reduce_installment');
    expect(result.after).toMatchObject({ balanceMinor: 800_000, remainingPeriods: 11, installmentMinor: 72_727 });
    expect(result.savings).toEqual({ interestMinor: 0, chargesMinor: 0 });
  });

  it('advance installments: same installment, fewer installments, nothing saved', () => {
    const result = zero('advance_installments');
    expect(result.after).toMatchObject({ remainingPeriods: 8, installmentMinor: 100_000, nextDueOn: '2026-06-15' });
    expect(result.savings.interestMinor).toBe(0);
    expect(result.extraPrincipalMinor).toBe(0);
  });
});

describe('simulateExtra on a 24% EA loan (10,000,000 x 36, 12 paid, +2,000,000)', () => {
  const payments = onTime(french(), 12);
  const run = (strategy) => simulateExtra(debt(french()), payments, { amountMinor: 2_000_000, strategy, on: '2027-01-20' });

  it('reduce term keeps the installment and shortens the plan', () => {
    const result = run('reduce_term');
    expect(result.before).toMatchObject({ remainingPeriods: 24, installmentMinor: 380_381 });
    expect(result.after.installmentMinor).toBe(380_381);
    expect(result.after.remainingPeriods).toBeLessThan(24);
    expect(result.eaPercent).toBeCloseTo(24, 6);
  });

  it('reduce installment keeps the term and lowers the installment', () => {
    const result = run('reduce_installment');
    expect(result.after.remainingPeriods).toBe(24);
    expect(result.after.installmentMinor).toBeLessThan(380_381);
  });

  it('saves interest, more with reduce term; advance saves none; remaining interest drops by the saving', () => {
    const [term, installment, advance] = STRATEGIES.map(run);
    expect(installment.savings.interestMinor).toBeGreaterThan(0);
    expect(term.savings.interestMinor).toBeGreaterThan(installment.savings.interestMinor);
    expect(advance.savings.interestMinor).toBe(0);
    expect(term.before.remainingInterestMinor - term.after.remainingInterestMinor).toBe(term.savings.interestMinor);
  });

  it('counts the savings in charges and taxes too', () => {
    const insured = french({ charges: [{ id: 'ins', kind: 'insurance', label: 'Life', basis: 'pctOutstanding', value: 0.05 }] });
    const result = simulateExtra(debt(insured), onTime(insured, 12), { amountMinor: 2_000_000, strategy: 'reduce_term', on: '2027-01-20' });
    expect(result.savings.chargesMinor).toBeGreaterThan(0);
    expect(result.before.remainingChargesMinor - result.after.remainingChargesMinor).toBe(result.savings.chargesMinor);
  });
});

describe('simulateExtra caps and guards', () => {
  it('an extra above the balance is a full payoff capped at the balance, never negative', () => {
    const results = STRATEGIES.map((strategy) => zero(strategy, 5_000_000));
    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result).toMatchObject({ paidOff: true, appliedMinor: 1_100_000, surplusMinor: 3_900_000 });
      expect(result.after).toMatchObject({ balanceMinor: 0, remainingPeriods: 0, installmentMinor: 0, lastDueOn: null });
    }
  });

  it('does not mutate its inputs', () => {
    const terms = deepFreeze(french());
    const events = deepFreeze(onTime(french(), 3));
    const before = JSON.stringify([terms, events]);
    for (const strategy of STRATEGIES) simulateExtra(debt(terms), events, { amountMinor: 500_000, strategy, on: '2026-06-01' });
    expect(JSON.stringify([terms, events])).toBe(before);
  });

  it('reports the prepayment penalty as information only (default 0)', () => {
    const request = { amountMinor: 2_000_000, strategy: 'reduce_term', on: '2027-01-20' };
    const plain = simulateExtra(debt(french()), onTime(french(), 12), request);
    const penalized = simulateExtra(debt(french({ prepaymentPenaltyPct: 2 })), onTime(french(), 12), request);
    expect(plain).toMatchObject({ penaltyPct: 0, penaltyMinor: 0 });
    expect(penalized).toMatchObject({ penaltyPct: 2, penaltyMinor: 40_000 });
    expect(penalized.savings).toEqual(plain.savings);
    expect(penalized.after).toEqual(plain.after);
  });

  it('rejects invalid requests with a typed error', () => {
    const base = { amountMinor: 100_000, strategy: 'reduce_term', on: '2026-03-01' };
    const run = (patch) => () => simulateExtra(debt(interestFree()), paidOne, { ...base, ...patch });
    expect(run({ amountMinor: 0 })).toThrow(/amount/);
    expect(run({ amountMinor: 10.5 })).toThrow(/integer/);
    expect(run({ strategy: 'burn' })).toThrow(/strategy/);
    expect(run({ on: '2026-02-30' })).toThrow(/date/);
  });
});
