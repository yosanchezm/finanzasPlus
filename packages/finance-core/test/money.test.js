// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/errors.js';
import { assertMinor, roundUnit, sumMinor } from '../src/money.js';

describe('roundUnit', () => {
  it('rounds to whole pesos by default, half away from zero', () => {
    expect(roundUnit(2.5)).toBe(3);
    expect(roundUnit(2.4)).toBe(2);
    expect(roundUnit(180875.824835)).toBe(180876);
    expect(roundUnit(0.5)).toBe(1);
  });

  it('rounds negative halves away from zero, not toward +infinity', () => {
    expect(roundUnit(-2.5)).toBe(-3);
    expect(roundUnit(-2.4)).toBe(-2);
    expect(roundUnit(-0.5)).toBe(-1);
    expect(roundUnit(-180875.5)).toBe(-180876);
  });

  it('rounds to a coarser unit such as 100 pesos', () => {
    expect(roundUnit(149, 100)).toBe(100);
    expect(roundUnit(150, 100)).toBe(200);
    expect(roundUnit(-150, 100)).toBe(-200);
    expect(roundUnit(-149, 100)).toBe(-100);
    expect(roundUnit(1234567, 100)).toBe(1234600);
  });

  it('never returns negative zero', () => {
    expect(Object.is(roundUnit(-0.2), 0)).toBe(true);
    expect(Object.is(roundUnit(-30, 100), 0)).toBe(true);
  });

  it('leaves integers on the unit grid untouched', () => {
    expect(roundUnit(380381)).toBe(380381);
    expect(roundUnit(300, 100)).toBe(300);
  });

  it('rejects non-finite input and non-positive units with a typed error', () => {
    expect(() => roundUnit(Number.NaN)).toThrow(ValidationError);
    expect(() => roundUnit(Infinity)).toThrow(ValidationError);
    expect(() => roundUnit(10, 0)).toThrow(ValidationError);
    expect(() => roundUnit(10, -5)).toThrow(ValidationError);
    expect(() => roundUnit(10, Number.NaN)).toThrow(ValidationError);
  });
});

describe('assertMinor', () => {
  it('returns the integer it was given', () => {
    expect(assertMinor(10000000)).toBe(10000000);
    expect(assertMinor(0)).toBe(0);
    expect(assertMinor(-350)).toBe(-350);
  });

  it('rejects fractions, NaN, infinities and non-numbers', () => {
    for (const bad of [1.5, Number.NaN, Infinity, -Infinity, '100', null, undefined, 2 ** 60]) {
      expect(() => assertMinor(bad)).toThrow(ValidationError);
    }
  });

  it('reports a stable error code and the label of the offending field', () => {
    let caught;
    try {
      assertMinor(0.1, 'principalMinor');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught.name).toBe('ValidationError');
    expect(caught.code).toBe('invalid_minor');
    expect(caught.message).toContain('principalMinor');
  });
});

describe('sumMinor', () => {
  it('adds integer amounts exactly', () => {
    expect(sumMinor([10000, 1900, 600000])).toBe(611900);
    expect(sumMinor([100000, -25000])).toBe(75000);
  });

  it('sums an empty list to zero', () => {
    expect(sumMinor([])).toBe(0);
  });

  it('rejects a list holding a fraction, so drift cannot sneak in', () => {
    expect(() => sumMinor([100, 0.5])).toThrow(ValidationError);
    expect(() => sumMinor([100, Number.NaN])).toThrow(ValidationError);
  });

  it('rejects a non-array argument', () => {
    expect(() => sumMinor(undefined)).toThrow(ValidationError);
    expect(() => sumMinor('100')).toThrow(ValidationError);
  });
});
