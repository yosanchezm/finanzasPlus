import { describe, expect, it } from 'vitest';
import { formatDate, formatMoney, formatMonth, formatSignedMoney } from './format';

describe('formatMoney', () => {
  it('formats COP without decimals and with a regular space after the symbol', () => {
    expect(formatMoney(286400)).toBe('$ 286.400');
    expect(formatMoney(5200000)).toBe('$ 5.200.000');
  });

  it('treats empty or invalid values as zero', () => {
    expect(formatMoney(0)).toBe('$ 0');
    expect(formatMoney(undefined)).toBe('$ 0');
    expect(formatMoney('abc')).toBe('$ 0');
  });

  it('accepts numeric strings', () => {
    expect(formatMoney('1500')).toBe('$ 1.500');
  });
});

describe('formatSignedMoney', () => {
  it('uses a true minus sign for negative values', () => {
    expect(formatSignedMoney(-245300)).toBe('− $ 245.300');
    expect(formatSignedMoney(320000)).toBe('$ 320.000');
  });
});

describe('formatDate', () => {
  it('renders day and abbreviated month', () => {
    expect(formatDate(new Date(2026, 9, 28, 12).toISOString())).toBe('28 oct');
    expect(formatDate(new Date(2026, 0, 3, 12).toISOString())).toBe('3 ene');
  });

  it('falls back when the date is missing or invalid', () => {
    expect(formatDate('')).toBe('Sin fecha');
    expect(formatDate(undefined)).toBe('Sin fecha');
    expect(formatDate('not a date')).toBe('Sin fecha');
  });
});

describe('formatMonth', () => {
  it('renders the month key as month and year', () => {
    expect(formatMonth('2026-10')).toBe('octubre de 2026');
  });
});
