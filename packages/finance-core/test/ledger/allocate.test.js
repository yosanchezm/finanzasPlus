// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/errors.js';
import { allocate, allocateSplit } from '../../src/ledger/allocate.js';
import { mulberry32 } from '../helpers/prng.js';

// The canonical first installment of the French 10,000,000 / 24% EA / 36 loan
// plus a 10,000 fee: charges 10,000, interest 180,876, principal 199,505.
const ROW = { charges: 10_000, taxes: 0, lateInterest: 0, interest: 180_876, principal: 199_505 };
const BUCKETS = ['charges', 'taxes', 'lateInterest', 'interest', 'principal'];
const total = (allocation) => BUCKETS.reduce((sum, key) => sum + allocation[key], 0) + allocation.surplus;

describe('allocate: default order (charges, taxes, late interest, interest, principal)', () => {
  it('short payment covers charges, then interest, and leaves principal untouched', () => {
    const allocation = allocate(100_000, ROW);
    expect(allocation).toEqual({ charges: 10_000, taxes: 0, lateInterest: 0, interest: 90_000, principal: 0, surplus: 0 });
    // What remains due: 90,876 of interest and the whole principal.
    expect(ROW.interest - allocation.interest).toBe(90_876);
    expect(ROW.principal - allocation.principal).toBe(199_505);
  });

  it('an exact payment equals the row and the allocated total equals the amount', () => {
    const allocation = allocate(390_381, ROW);
    expect(allocation).toEqual({ charges: 10_000, taxes: 0, lateInterest: 0, interest: 180_876, principal: 199_505, surplus: 0 });
    expect(total(allocation)).toBe(390_381);
  });

  it('reports the surplus when the amount exceeds everything due', () => {
    const allocation = allocate(500_000, ROW);
    expect(allocation).toMatchObject({ charges: 10_000, interest: 180_876, principal: 199_505, surplus: 109_619 });
    expect(total(allocation)).toBe(500_000);
  });

  it('pays taxes right after charges and late interest before current interest', () => {
    const due = { charges: 10_000, taxes: 1_900, lateInterest: 5_000, interest: 50_000, principal: 100_000 };
    expect(allocate(12_000, due)).toMatchObject({ charges: 10_000, taxes: 1_900, lateInterest: 100, interest: 0, principal: 0 });
    expect(allocate(20_000, due)).toMatchObject({ charges: 10_000, taxes: 1_900, lateInterest: 5_000, interest: 3_100, principal: 0 });
  });

  it('allocates nothing for a zero amount and treats missing buckets as 0', () => {
    expect(allocate(0, ROW)).toEqual({ charges: 0, taxes: 0, lateInterest: 0, interest: 0, principal: 0, surplus: 0 });
    expect(allocate(5_000, { interest: 3_000, principal: 10_000 })).toMatchObject({ interest: 3_000, principal: 2_000, charges: 0, surplus: 0 });
  });
});

describe('allocate: custom allocationOrder', () => {
  it('follows the given order and appends the unlisted buckets in the default order', () => {
    expect(allocate(250_000, ROW, ['principal', 'interest'])).toMatchObject({ principal: 199_505, interest: 50_495, charges: 0 });
    expect(allocate(205_000, ROW, ['interest', 'principal', 'charges'])).toMatchObject({ interest: 180_876, principal: 24_124, charges: 0 });
    expect(allocate(205_000, ROW, ['principal'])).toMatchObject({ principal: 199_505, charges: 5_495, interest: 0 });
  });

  it('rejects unknown or repeated buckets with a stable code', () => {
    for (const order of [['fees'], ['interest', 'interest'], 'interest']) {
      try {
        allocate(1_000, ROW, order);
        throw new Error('expected a ValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.code).toBe('invalid_allocation_order');
      }
    }
  });
});

describe('allocate: invalid input', () => {
  it('rejects negative or fractional amounts and malformed buckets', () => {
    expect(() => allocate(-1, ROW)).toThrow(ValidationError);
    expect(() => allocate(10.5, ROW)).toThrow(ValidationError);
    expect(() => allocate(100, { interest: -3 })).toThrow(ValidationError);
    expect(() => allocate(100, { interest: 2.5 })).toThrow(ValidationError);
  });
});

describe('allocate: invariants over 200 seeded cases', () => {
  it('the allocated total plus surplus equals the amount, no bucket exceeds what is due, earlier buckets fill first', () => {
    const random = mulberry32(2026);
    const pick = (max) => Math.floor(random() * max);
    const orders = [undefined, ['principal', 'interest', 'charges'], ['interest', 'charges', 'taxes', 'lateInterest', 'principal']];
    let withSurplus = 0;
    let partial = 0;
    for (let round = 0; round < 200; round += 1) {
      const due = { charges: pick(20_000), taxes: pick(4_000), lateInterest: pick(9_000), interest: pick(300_000), principal: pick(500_000) };
      const amount = pick(900_000);
      const order = orders[round % orders.length];
      const allocation = allocate(amount, due, order);
      expect(total(allocation)).toBe(amount);
      for (const key of BUCKETS) {
        expect(allocation[key]).toBeGreaterThanOrEqual(0);
        expect(allocation[key]).toBeLessThanOrEqual(due[key]);
      }
      const sequence = order === undefined ? BUCKETS : [...order, ...BUCKETS.filter((key) => !order.includes(key))];
      // A bucket receives money only once every bucket before it is fully covered.
      sequence.forEach((key, index) => {
        if (allocation[key] > 0) expect(sequence.slice(0, index).every((earlier) => allocation[earlier] === due[earlier])).toBe(true);
      });
      if (allocation.surplus > 0) withSurplus += 1;
      else if (BUCKETS.some((key) => allocation[key] < due[key])) partial += 1;
    }
    expect(withSurplus).toBeGreaterThan(10);
    expect(partial).toBeGreaterThan(10);
  });
});

describe('allocateSplit: a bank-stated split overrides the allocation order', () => {
  it('takes each bucket as stated, whatever the default order would have done', () => {
    const split = { charges: 10_000, interest: 150_000, principal: 150_000 };
    const { taken, left } = allocateSplit(split, ROW);
    expect(taken).toEqual({ charges: 10_000, taxes: 0, lateInterest: 0, interest: 150_000, principal: 150_000 });
    expect(left).toEqual({ charges: 0, taxes: 0, lateInterest: 0, interest: 0, principal: 0 });
    // The default order would have paid the whole interest before any principal.
    expect(allocate(310_000, ROW)).toMatchObject({ interest: 180_876, principal: 119_124 });
  });

  it('caps each bucket at what is due and returns the rest for the next row', () => {
    const { taken, left } = allocateSplit({ charges: 12_000, interest: 200_000, principal: 250_000 }, ROW);
    expect(taken).toEqual({ charges: 10_000, taxes: 0, lateInterest: 0, interest: 180_876, principal: 199_505 });
    expect(left).toEqual({ charges: 2_000, taxes: 0, lateInterest: 0, interest: 19_124, principal: 50_495 });
  });

  it('is pure and rejects malformed splits', () => {
    const split = { interest: 1_000 };
    allocateSplit(split, ROW);
    expect(split).toEqual({ interest: 1_000 });
    expect(() => allocateSplit({ interest: -1 }, ROW)).toThrow(ValidationError);
  });
});
