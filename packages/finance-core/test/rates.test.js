// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PERIODICITIES } from '../src/calendar.js';
import { ValidationError } from '../src/errors.js';
import {
  CONVENTIONS,
  convertRate,
  normalizeRate,
  periodicRate,
  rateLabel,
  toEffectiveAnnual,
} from '../src/rates.js';
import { mulberry32 } from './helpers/prng.js';

const EA_24 = normalizeRate({ convention: 'EA', value: 24 });
const MV_2_1 = normalizeRate({ convention: 'MV', value: 2.1 });

describe('CONVENTIONS and normalizeRate', () => {
  it('lists the supported conventions', () => {
    expect(Object.keys(CONVENTIONS)).toEqual(['EA', 'NAMV', 'MV', 'NATV', 'NATA', 'NAMA', 'ZERO']);
    expect(Object.isFrozen(CONVENTIONS)).toBe(true);
  });

  it('stores the rate exactly as stated, mapped onto basis, periodicity and timing', () => {
    expect(normalizeRate({ convention: 'EA', value: 24 })).toEqual({
      value: 24,
      basis: 'effective',
      periodicity: 'annual',
      timing: 'arrears',
    });
    expect(normalizeRate({ convention: 'MV', value: 2.1 })).toEqual({
      value: 2.1,
      basis: 'effective',
      periodicity: 'monthly',
      timing: 'arrears',
    });
    expect(normalizeRate({ convention: 'NAMV', value: 25.2 })).toEqual({
      value: 25.2,
      basis: 'nominal',
      periodicity: 'monthly',
      timing: 'arrears',
    });
    expect(normalizeRate({ convention: 'NATV', value: 24 })).toMatchObject({ basis: 'nominal', periodicity: 'quarterly', timing: 'arrears' });
    expect(normalizeRate({ convention: 'NATA', value: 24 })).toMatchObject({ basis: 'nominal', periodicity: 'quarterly', timing: 'advance' });
    expect(normalizeRate({ convention: 'NAMA', value: 24 })).toMatchObject({ basis: 'nominal', periodicity: 'monthly', timing: 'advance' });
  });

  it('treats ZERO as interest-free whatever value accompanies it', () => {
    expect(normalizeRate({ convention: 'ZERO' })).toEqual({
      value: 0,
      basis: 'effective',
      periodicity: 'annual',
      timing: 'arrears',
    });
    expect(normalizeRate({ convention: 'ZERO', value: 18 }).value).toBe(0);
  });

  it('accepts an already-structured rate and fills the default timing', () => {
    expect(normalizeRate({ value: 9, basis: 'nominal', periodicity: 'quarterly' })).toEqual({
      value: 9,
      basis: 'nominal',
      periodicity: 'quarterly',
      timing: 'arrears',
    });
  });

  it('rejects unknown conventions, bases, periodicities and timings', () => {
    expect(() => normalizeRate({ convention: 'XYZ', value: 5 })).toThrow(ValidationError);
    expect(() => normalizeRate({ value: 5, basis: 'magic', periodicity: 'monthly' })).toThrow(ValidationError);
    expect(() => normalizeRate({ value: 5, basis: 'effective', periodicity: 'fortnightly' })).toThrow(ValidationError);
    expect(() => normalizeRate({ value: 5, basis: 'effective', periodicity: 'monthly', timing: 'later' })).toThrow(ValidationError);
    expect(() => normalizeRate(null)).toThrow(ValidationError);
  });
});

describe('periodicRate and toEffectiveAnnual (spec scenarios)', () => {
  it('converts 24% EA to the monthly rate i = 1.24^(1/12) - 1', () => {
    const monthly = periodicRate(EA_24, 'monthly');
    expect(Math.abs(monthly - (1.24 ** (1 / 12) - 1))).toBeLessThan(1e-6);
    expect(Math.abs(monthly - 0.0180875824835107)).toBeLessThan(1e-12);
  });

  it('round-trips the monthly rate back to 24% EA within 1e-9', () => {
    const monthly = periodicRate(EA_24, 'monthly');
    expect(Math.abs(((1 + monthly) ** 12 - 1) * 100 - 24)).toBeLessThan(1e-9);
    expect(Math.abs(toEffectiveAnnual(EA_24) - 24)).toBeLessThan(1e-9);
  });

  it('converts EA to other periodicities', () => {
    expect(Math.abs(periodicRate(EA_24, 'quarterly') - 0.05525014691588859)).toBeLessThan(1e-12);
    expect(Math.abs(periodicRate(EA_24, 'semiannual') - 0.11355287256600444)).toBeLessThan(1e-12);
    expect(Math.abs(periodicRate(EA_24, 'weekly') - 0.0041453254915753135)).toBeLessThan(1e-12);
    expect(periodicRate(EA_24, 'annual')).toBeCloseTo(0.24, 12);
  });

  it('gives about 28.32% EA for 2.1% monthly and for 25.2% NAMV alike', () => {
    const namv = normalizeRate({ convention: 'NAMV', value: 25.2 });
    expect(toEffectiveAnnual(MV_2_1)).toBeCloseTo(28.3243, 4);
    expect(toEffectiveAnnual(namv)).toBeCloseTo(28.3243, 4);
    expect(Math.abs(toEffectiveAnnual(namv) - toEffectiveAnnual(MV_2_1))).toBeLessThan(1e-9);
    expect(periodicRate(namv, 'monthly')).toBeCloseTo(0.021, 12);
  });

  it('uses i = ia / (1 - ia) for 2% monthly anticipated', () => {
    const anticipated = { value: 2, basis: 'effective', periodicity: 'monthly', timing: 'advance' };
    expect(Math.abs(periodicRate(anticipated, 'monthly') - 0.02 / 0.98)).toBeLessThan(1e-12);
    expect(Math.abs(toEffectiveAnnual(anticipated) - (0.98 ** -12 - 1) * 100)).toBeLessThan(1e-9);
  });

  it('treats a nominal anticipated rate like its monthly anticipated equivalent', () => {
    const nama = normalizeRate({ convention: 'NAMA', value: 24 });
    const anticipated = { value: 2, basis: 'effective', periodicity: 'monthly', timing: 'advance' };
    expect(Math.abs(periodicRate(nama, 'monthly') - periodicRate(anticipated, 'monthly'))).toBeLessThan(1e-12);
  });

  it('gives 0 for an interest-free rate in every periodicity, and 0 EA', () => {
    const zero = normalizeRate({ convention: 'ZERO' });
    for (const periodicity of Object.keys(PERIODICITIES)) {
      expect(periodicRate(zero, periodicity)).toBe(0);
    }
    expect(toEffectiveAnnual(zero)).toBe(0);
    expect(convertRate(zero, 'NAMV').value).toBe(0);
  });

  it('differs from zero for a positive rate (zero is not the default answer)', () => {
    expect(periodicRate(EA_24, 'monthly')).toBeGreaterThan(0.018);
    expect(toEffectiveAnnual(MV_2_1)).toBeGreaterThan(28);
  });
});

describe('invalid rates', () => {
  const failure = (fn) => {
    let result;
    let error;
    try {
      result = fn();
    } catch (caught) {
      error = caught;
    }
    return { result, error };
  };

  it('rejects an anticipated rate of 100% with a typed error and produces no number', () => {
    const hundred = { value: 100, basis: 'effective', periodicity: 'monthly', timing: 'advance' };
    for (const run of [
      () => normalizeRate(hundred),
      () => periodicRate(hundred, 'monthly'),
      () => toEffectiveAnnual(hundred),
      () => convertRate(hundred, 'EA'),
    ]) {
      const { result, error } = failure(run);
      expect(result).toBeUndefined();
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.code).toBe('invalid_rate');
    }
  });

  it('rejects anticipated rates above 100% and nominal anticipated rates whose period rate reaches 100%', () => {
    expect(() => normalizeRate({ value: 150, basis: 'effective', periodicity: 'monthly', timing: 'advance' })).toThrow(ValidationError);
    expect(() => normalizeRate({ value: 1200, basis: 'nominal', periodicity: 'monthly', timing: 'advance' })).toThrow(ValidationError);
    expect(() => normalizeRate({ value: 1100, basis: 'nominal', periodicity: 'monthly', timing: 'advance' })).not.toThrow();
  });

  it('rejects negative, non-finite and non-numeric values', () => {
    for (const value of [-1, -0.001, Number.NaN, Infinity, -Infinity, '24', null, undefined]) {
      const { result, error } = failure(() => normalizeRate({ convention: 'EA', value }));
      expect(result).toBeUndefined();
      expect(error).toBeInstanceOf(ValidationError);
    }
  });

  it('rejects an unknown target periodicity or convention when converting', () => {
    expect(() => periodicRate(EA_24, 'fortnightly')).toThrow(ValidationError);
    expect(() => convertRate(EA_24, 'XYZ')).toThrow(ValidationError);
  });
});

describe('convertRate', () => {
  it('converts a stated rate to another convention', () => {
    const toMv = convertRate(EA_24, 'MV');
    expect(toMv).toMatchObject({ basis: 'effective', periodicity: 'monthly', timing: 'arrears' });
    expect(Math.abs(toMv.value - 1.80875824835107)).toBeLessThan(1e-10);

    const toNamv = convertRate(EA_24, 'NAMV');
    expect(toNamv).toMatchObject({ basis: 'nominal', periodicity: 'monthly' });
    expect(Math.abs(toNamv.value - 12 * toMv.value)).toBeLessThan(1e-10);

    expect(convertRate(MV_2_1, 'EA').value).toBeCloseTo(28.3243, 4);
  });

  it('accepts a structured target and converts to the anticipated timing', () => {
    const target = { basis: 'effective', periodicity: 'monthly', timing: 'advance' };
    const converted = convertRate(MV_2_1, target);
    expect(converted.timing).toBe('advance');
    expect(converted.value).toBeCloseTo((0.021 / 1.021) * 100, 10);
  });

  it('round-trips seeded random rates between every pair of conventions within 1e-9', () => {
    const random = mulberry32(20261012);
    const names = Object.keys(CONVENTIONS).filter((name) => name !== 'ZERO');
    let cases = 0;
    for (const from of names) {
      for (const to of names) {
        for (let run = 0; run < 25; run += 1) {
          const value = random() * 60;
          const original = normalizeRate({ convention: from, value });
          const there = convertRate(original, to);
          const back = convertRate(there, from);
          expect(Math.abs(back.value - value)).toBeLessThan(1e-9);
          cases += 1;
        }
      }
    }
    expect(cases).toBe(names.length * names.length * 25);
  });

  it('round-trips through EA for every basis, periodicity and timing within 1e-9', () => {
    const random = mulberry32(42);
    const bases = ['effective', 'nominal'];
    const timings = ['arrears', 'advance'];
    let cases = 0;
    for (const basis of bases) {
      for (const periodicity of Object.keys(PERIODICITIES)) {
        for (const timing of timings) {
          for (let run = 0; run < 20; run += 1) {
            const value = random() * 60;
            const rate = normalizeRate({ value, basis, periodicity, timing });
            const ea = normalizeRate({ convention: 'EA', value: toEffectiveAnnual(rate) });
            const back = convertRate(ea, { basis, periodicity, timing });
            expect(Math.abs(back.value - value)).toBeLessThan(1e-9);
            cases += 1;
          }
        }
      }
    }
    expect(cases).toBe(2 * 7 * 2 * 20);
  });
});

describe('rateLabel', () => {
  it('echoes the stated rate with its EA equivalent', () => {
    expect(rateLabel(MV_2_1)).toBe('2.1% MV ≈ 28.32% EA');
    expect(rateLabel(normalizeRate({ convention: 'NAMV', value: 25.2 }))).toBe('25.2% NAMV ≈ 28.32% EA');
    expect(rateLabel(normalizeRate({ convention: 'MV', value: 1.5 }))).toBe('1.5% MV ≈ 19.56% EA');
  });

  it('shows an effective annual rate without a redundant equivalent', () => {
    expect(rateLabel(EA_24)).toBe('24% EA');
    expect(rateLabel(normalizeRate({ convention: 'ZERO' }))).toBe('0% EA');
  });

  it('describes a rate outside the named conventions', () => {
    const anticipated = { value: 2, basis: 'effective', periodicity: 'monthly', timing: 'advance' };
    expect(rateLabel(anticipated)).toBe('2% monthly advance ≈ 27.43% EA');
  });
});
