import { describe, expect, it } from 'vitest';
import { addMonths, monthKeyOf, monthRange, monthsEndingAt } from './dates';

describe('addMonths', () => {
  it('moves across year boundaries in both directions', () => {
    expect(addMonths('2026-10', 1)).toBe('2026-11');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-03', -5)).toBe('2025-10');
  });
});

describe('monthRange', () => {
  it('returns the local start of the month and of the next month as ISO strings', () => {
    expect(monthRange('2026-10')).toEqual({
      start: new Date(2026, 9, 1).toISOString(),
      end: new Date(2026, 10, 1).toISOString(),
    });
    expect(monthRange('2026-12').end).toBe(new Date(2027, 0, 1).toISOString());
  });
});

describe('monthsEndingAt', () => {
  it('lists the months oldest first, ending at the given month', () => {
    expect(monthsEndingAt('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('monthKeyOf', () => {
  it('uses local time, matching monthRange', () => {
    expect(monthKeyOf(new Date(2026, 9, 1, 0, 30).toISOString())).toBe('2026-10');
    expect(monthKeyOf(new Date(2026, 8, 30, 23, 30).toISOString())).toBe('2026-09');
    expect(monthKeyOf('')).toBe('');
  });
});
