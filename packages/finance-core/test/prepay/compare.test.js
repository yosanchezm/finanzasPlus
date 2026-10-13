// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { compareStrategies } from '../../src/prepay/compare.js';
import { mulberry32 } from '../helpers/prng.js';
import { EA, debt, deepFreeze, ev, french, interestFree, onTime } from '../helpers/loans.js';

// DPA-1: side by side comparison of the three strategies on the same extra.

const request = { amountMinor: 2_000_000, on: '2027-01-20' };
const payments = onTime(french(), 12);

describe('compareStrategies', () => {
  it('French 10,000,000 at 24% EA after 12 payments, +2,000,000: term shrinks, installment holds, interest saved is higher', () => {
    const result = compareStrategies(debt(french()), payments, request);
    expect(result).toMatchObject({ on: '2027-01-20', amountMinor: 2_000_000, kind: 'consumer', system: 'french', identical: false, notes: [] });
    expect(result.reduceTerm.after.remainingPeriods).toBeLessThan(result.reduceInstallment.after.remainingPeriods);
    expect(result.reduceTerm.after.installmentMinor).toBe(380_381);
    expect(result.reduceInstallment.after.installmentMinor).toBeLessThan(380_381);
    expect(result.reduceTerm.savings.interestMinor).toBeGreaterThanOrEqual(result.reduceInstallment.savings.interestMinor);
    expect(result.advance.savings.interestMinor).toBe(0);
    expect(result.advance.strategy).toBe('advance_installments');
  });

  it('0% loan: both strategies save 0 but still differ in term and installment', () => {
    const family = interestFree();
    const result = compareStrategies(debt(family), [ev('payment', '2026-02-15', 100_000, {}, 'p1')], { amountMinor: 300_000, on: '2026-03-01' });
    expect(result.eaPercent).toBe(0);
    expect(result.reduceTerm.after).toMatchObject({ remainingPeriods: 8, installmentMinor: 100_000 });
    expect(result.reduceInstallment.after).toMatchObject({ remainingPeriods: 11, installmentMinor: 72_727 });
    expect([result.reduceTerm.savings.interestMinor, result.reduceInstallment.savings.interestMinor]).toEqual([0, 0]);
    expect(result.identical).toBe(false);
  });

  it('non-French systems keep their term under both reduce strategies, so the comparison says they are identical', () => {
    const german = french({ system: 'german', n: 24 });
    const result = compareStrategies(debt(german), onTime(german, 6), { amountMinor: 1_000_000, on: '2026-08-01' });
    expect(result.identical).toBe(true);
    expect(result.notes).toEqual([{ code: 'strategies_identical', system: 'german', paidOff: false }]);
    expect(result.reduceTerm.after).toEqual(result.reduceInstallment.after);
    expect(result.reduceTerm.savings.interestMinor).toBeGreaterThan(0);
  });

  it('does not mutate its inputs', () => {
    const terms = deepFreeze(french());
    const events = deepFreeze(onTime(french(), 12));
    const before = JSON.stringify([terms, events]);
    compareStrategies(debt(terms), events, request);
    expect(JSON.stringify([terms, events])).toBe(before);
  });

  it('seeded property over 200 French loans: reduce term never saves less interest than reduce installment, advance saves none', () => {
    const random = mulberry32(2026);
    let withSavings = 0;
    for (let index = 0; index < 200; index += 1) {
      const n = 12 + Math.floor(random() * 49);
      const terms = french({ principalMinor: 1_000_000 + Math.floor(random() * 49_000_000), n, rate: index % 10 === 0 ? { convention: 'ZERO' } : EA(5 + random() * 35) });
      const paid = 1 + Math.floor(random() * (n - 2));
      const events = onTime(terms, paid);
      const on = events[paid - 1].effectiveOn;
      const balance = debt(terms);
      const base = compareStrategies(balance, events, { amountMinor: 1, on });
      const amountMinor = Math.max(1, Math.floor(base.reduceTerm.before.balanceMinor * (0.01 + random() * 0.85)));
      const result = compareStrategies(balance, events, { amountMinor, on });
      expect(result.reduceTerm.savings.interestMinor).toBeGreaterThanOrEqual(result.reduceInstallment.savings.interestMinor);
      expect(result.reduceInstallment.savings.interestMinor).toBeGreaterThanOrEqual(0);
      expect(result.advance.savings.interestMinor).toBe(0);
      expect(result.reduceTerm.after.balanceMinor).toBe(result.reduceTerm.before.balanceMinor - amountMinor);
      if (result.reduceTerm.savings.interestMinor > 0) withSavings += 1;
    }
    expect(withSavings).toBeGreaterThan(150);
  });
});
