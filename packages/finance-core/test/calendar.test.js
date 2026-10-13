// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  PERIODICITIES,
  addDays,
  addMonthsClamped,
  compareIso,
  daysBetween,
  hasPeriodicity,
  isIsoDate,
  periodDates,
} from '../src/calendar.js';
import { ValidationError } from '../src/errors.js';

describe('isIsoDate', () => {
  it('accepts real calendar dates, including a leap day', () => {
    expect(isIsoDate('2026-10-12')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-12-31')).toBe(true);
  });

  it('rejects impossible dates and wrong formats', () => {
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-00-10')).toBe(false);
    expect(isIsoDate('2026-04-31')).toBe(false);
    expect(isIsoDate('2026-1-1')).toBe(false);
    expect(isIsoDate(' 2026-01-01')).toBe(false);
    expect(isIsoDate('2026-01-01T00:00:00')).toBe(false);
  });

  it('rejects values that are not strings', () => {
    expect(isIsoDate(20260101)).toBe(false);
    expect(isIsoDate(null)).toBe(false);
    expect(isIsoDate(new Date(Date.UTC(2026, 0, 1)))).toBe(false);
  });
});

describe('addDays', () => {
  it('moves forward across month, year and leap boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('moves backward and by zero', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-05-17', 0)).toBe('2026-05-17');
  });

  it('adds whole weeks without drifting across a daylight-saving change', () => {
    expect(addDays('2026-03-01', 14)).toBe('2026-03-15');
    expect(addDays('2026-10-01', 400)).toBe('2027-11-05');
  });

  it('rejects an invalid date or a fractional day count', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(ValidationError);
    expect(() => addDays('2026-02-01', 1.5)).toThrow(ValidationError);
  });
});

describe('addMonthsClamped', () => {
  it('clamps to the end of a short month and recovers the anchor day afterwards', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(addMonthsClamped('2026-01-31', 2)).toBe('2026-03-31');
  });

  it('uses 29 February in a leap year', () => {
    expect(addMonthsClamped('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonthsClamped('2023-01-31', 1)).toBe('2023-02-28');
  });

  it('crosses year boundaries in both directions', () => {
    expect(addMonthsClamped('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonthsClamped('2026-01-15', -2)).toBe('2025-11-15');
    expect(addMonthsClamped('2026-06-10', 12)).toBe('2027-06-10');
  });

  it('keeps the day when the target month is long enough', () => {
    expect(addMonthsClamped('2026-01-15', 1)).toBe('2026-02-15');
    expect(addMonthsClamped('2026-05-31', 1)).toBe('2026-06-30');
  });

  it('rejects an anchor day outside 1..31', () => {
    expect(() => addMonthsClamped('2026-01-15', 1, 0)).toThrow(ValidationError);
    expect(() => addMonthsClamped('2026-01-15', 1, 32)).toThrow(ValidationError);
    expect(() => addMonthsClamped('nope', 1)).toThrow(ValidationError);
  });
});

describe('periodDates', () => {
  it('clamps a day-31 monthly schedule and restores the anchor', () => {
    expect(periodDates('2026-01-31', 'monthly', 4)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('generates weekly and biweekly (14 days) dates', () => {
    expect(periodDates('2026-01-05', 'weekly', 3)).toEqual(['2026-01-05', '2026-01-12', '2026-01-19']);
    expect(periodDates('2026-01-05', 'biweekly', 3)).toEqual(['2026-01-05', '2026-01-19', '2026-02-02']);
  });

  it('generates bimonthly, quarterly, semiannual and annual dates', () => {
    expect(periodDates('2026-01-15', 'bimonthly', 3)).toEqual(['2026-01-15', '2026-03-15', '2026-05-15']);
    expect(periodDates('2026-01-31', 'quarterly', 3)).toEqual(['2026-01-31', '2026-04-30', '2026-07-31']);
    expect(periodDates('2026-08-31', 'semiannual', 3)).toEqual(['2026-08-31', '2027-02-28', '2027-08-31']);
    expect(periodDates('2024-02-29', 'annual', 5)).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ]);
  });

  it('honours an explicit anchor day different from the first date', () => {
    expect(periodDates('2026-02-28', 'monthly', 3, 31)).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('returns exactly count dates and an empty list for zero', () => {
    expect(periodDates('2026-01-15', 'monthly', 36)).toHaveLength(36);
    expect(periodDates('2026-01-15', 'monthly', 36)[35]).toBe('2028-12-15');
    expect(periodDates('2026-01-15', 'monthly', 0)).toEqual([]);
  });

  it('rejects an unknown periodicity, a bad count or a bad date', () => {
    expect(() => periodDates('2026-01-15', 'fortnightly', 3)).toThrow(ValidationError);
    expect(() => periodDates('2026-01-15', 'monthly', -1)).toThrow(ValidationError);
    expect(() => periodDates('2026-01-15', 'monthly', 2.5)).toThrow(ValidationError);
    expect(() => periodDates('2026-15-15', 'monthly', 3)).toThrow(ValidationError);
  });
});

describe('PERIODICITIES', () => {
  it('lists the seven supported periodicities with their periods per year', () => {
    expect(Object.keys(PERIODICITIES)).toEqual([
      'weekly',
      'biweekly',
      'monthly',
      'bimonthly',
      'quarterly',
      'semiannual',
      'annual',
    ]);
    expect(PERIODICITIES.monthly.perYear).toBe(12);
    expect(PERIODICITIES.biweekly.perYear).toBe(26);
    expect(PERIODICITIES.semiannual.perYear).toBe(2);
    expect(Object.isFrozen(PERIODICITIES)).toBe(true);
  });

  it('recognises only own periodicity names, never inherited object keys', () => {
    expect(hasPeriodicity('quarterly')).toBe(true);
    expect(hasPeriodicity('fortnightly')).toBe(false);
    expect(hasPeriodicity('toString')).toBe(false);
    expect(hasPeriodicity(12)).toBe(false);
    expect(() => periodDates('2026-01-15', 'constructor', 2)).toThrow(ValidationError);
  });
});

describe('daysBetween and compareIso', () => {
  it('counts calendar days, positive when the second date is later', () => {
    expect(daysBetween('2026-01-01', '2026-03-01')).toBe(59);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-05-10', '2026-05-10')).toBe(0);
  });

  it('is negative when the dates are reversed', () => {
    expect(daysBetween('2026-03-01', '2026-01-01')).toBe(-59);
  });

  it('orders ISO dates', () => {
    expect(compareIso('2026-01-31', '2026-02-01')).toBe(-1);
    expect(compareIso('2026-02-01', '2026-01-31')).toBe(1);
    expect(compareIso('2026-02-01', '2026-02-01')).toBe(0);
    expect(compareIso('2025-12-31', '2026-01-01')).toBe(-1);
  });

  it('rejects invalid dates', () => {
    expect(() => daysBetween('2026-01-01', 'soon')).toThrow(ValidationError);
    expect(() => compareIso('2026-02-30', '2026-03-01')).toThrow(ValidationError);
  });
});
