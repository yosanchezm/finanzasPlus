// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { describeLegalRate, isStorableLegalRate, previewLegalRate, readLegalRate, resolveMonth } from './legal.js';

const TODAY = '2026-10-14';
const read = (legal, today = TODAY) => readLegalRate(legal, { today });
const usury = (extra = {}) => ({ kind: 'usury', modality: 'consumer', month: 'noviembre', year: null, value: 28.2, ...extra });

describe('resolveMonth', () => {
  it.each([
    ['noviembre', '2026-10-14', { year: 2026, month: 11 }],
    ['octubre', '2026-10-14', { year: 2026, month: 10 }],
    ['marzo', '2026-10-14', { year: 2027, month: 3 }],
    ['enero', '2026-10-14', { year: 2027, month: 1 }],
    ['mayo', '2026-10-14', { year: 2026, month: 5 }],
    ['diciembre', '2026-01-15', { year: 2025, month: 12 }],
    ['febrero', '2026-12-20', { year: 2027, month: 2 }],
  ])('puts %s within 6 months of today when no year is given (today %s)', (name, today, expected) => {
    expect(resolveMonth(name, null, today)).toEqual(expected);
  });

  it('prefers the past on an exact six month tie, because a cap is certified before it is typed in', () => {
    expect(resolveMonth('abril', null, '2026-10-14')).toEqual({ year: 2026, month: 4 });
  });

  it('keeps an explicit year', () => {
    expect(resolveMonth('noviembre', 2025, TODAY)).toEqual({ year: 2025, month: 11 });
    expect(resolveMonth('enero', 2030, TODAY)).toEqual({ year: 2030, month: 1 });
  });

  it('reads accents, case, abbreviations, numbers and YYYY-MM', () => {
    expect(resolveMonth('  Noviembre ', null, TODAY)).toEqual({ year: 2026, month: 11 });
    expect(resolveMonth('NOV', null, TODAY)).toEqual({ year: 2026, month: 11 });
    expect(resolveMonth('sept', null, TODAY)).toEqual({ year: 2026, month: 9 });
    expect(resolveMonth(11, null, TODAY)).toEqual({ year: 2026, month: 11 });
    expect(resolveMonth('11', null, TODAY)).toEqual({ year: 2026, month: 11 });
    expect(resolveMonth('2027-02', null, TODAY)).toEqual({ year: 2027, month: 2 });
  });

  it('returns null for what is not a month or a sane year', () => {
    expect(resolveMonth('foo', null, TODAY)).toBeNull();
    expect(resolveMonth(13, null, TODAY)).toBeNull();
    expect(resolveMonth(0, null, TODAY)).toBeNull();
    expect(resolveMonth('', null, TODAY)).toBeNull();
    expect(resolveMonth(null, null, TODAY)).toBeNull();
    expect(resolveMonth('noviembre', 1850, TODAY)).toBeNull();
    expect(resolveMonth('noviembre', 2026.5, TODAY)).toBeNull();
  });
});

describe('readLegalRate: usury and IBC', () => {
  it('turns "la usura de noviembre es 28.2" into basis points for the month resolved in code', () => {
    expect(read(usury())).toEqual({
      legalRate: { kind: 'usury', modality: 'consumer', validFrom: '2026-11-01', validTo: '2026-11-30', value: 2820 },
      missingFields: [],
      problems: [],
    });
  });

  it('uses the last day of the month (February in a leap year) and the given year', () => {
    expect(read(usury({ month: 'febrero', year: 2028 })).legalRate).toMatchObject({ validFrom: '2028-02-01', validTo: '2028-02-29' });
    expect(read(usury({ month: 'febrero', year: 2027 })).legalRate).toMatchObject({ validFrom: '2027-02-01', validTo: '2027-02-28' });
  });

  it('reads an IBC and keeps it in basis points without rounding drift', () => {
    expect(read({ kind: 'ibc', modality: 'consumer', month: 'octubre', value: 19.49 }).legalRate).toMatchObject({ kind: 'ibc', value: 1949, validFrom: '2026-10-01' });
    expect(read(usury({ value: 28.29 })).legalRate.value).toBe(2829);
    expect(read(usury({ value: '28,2' })).legalRate.value).toBe(2820);
  });

  it('defaults the modality to consumer and understands the Spanish names', () => {
    expect(read(usury({ modality: null })).legalRate.modality).toBe('consumer');
    expect(read(usury({ modality: 'consumo y ordinario' })).legalRate.modality).toBe('consumer');
    expect(read(usury({ modality: 'Hipotecario' })).legalRate.modality).toBe('mortgage');
    expect(read(usury({ modality: 'productivo rural' })).legalRate.modality).toBe('productive_rural');
    expect(read(usury({ modality: 'productivo urbano' })).legalRate.modality).toBe('productive_urban');
    expect(read(usury({ modality: 'productivo' })).legalRate.modality).toBe('productive');
    expect(read(usury({ modality: 'popular urbano' })).legalRate.modality).toBe('popular_urban');
    expect(read(usury({ modality: 'popular rural' })).legalRate.modality).toBe('popular_rural');
    expect(read(usury({ modality: 'bajo monto' })).legalRate.modality).toBe('low_amount');
    expect(read(usury({ modality: 'low_amount' })).legalRate.modality).toBe('low_amount');
  });

  it('refuses a modality it does not know and writes no draft', () => {
    expect(read(usury({ modality: 'cripto' }))).toEqual({ legalRate: null, missingFields: [], problems: ['legal_unknown_modality'] });
  });

  it.each([2.82, 4.99, 100.01, 282, 0, -28.2, 28.255, Number.NaN, 'abc'])('refuses the value %s (outside 5-100 or not two decimals)', (value) => {
    expect(read(usury({ value }))).toEqual({ legalRate: null, missingFields: [], problems: ['legal_value_out_of_range'] });
  });

  it('accepts the edges 5 and 100', () => {
    expect(read(usury({ value: 5 })).legalRate.value).toBe(500);
    expect(read(usury({ value: 100 })).legalRate.value).toBe(10000);
  });

  it('never derives a mortgage cap from an IBC: the mortgage needs an explicit usury', () => {
    expect(read({ kind: 'ibc', modality: 'mortgage', month: 'noviembre', value: 19.49 })).toEqual({ legalRate: null, missingFields: [], problems: ['legal_mortgage_needs_usury'] });
    expect(read({ kind: 'usury', modality: 'mortgage', month: 'noviembre', value: 22.5 }).legalRate).toMatchObject({ kind: 'usury', modality: 'mortgage', value: 2250 });
  });

  it('asks for the month when it is missing and flags one it cannot read', () => {
    expect(read(usury({ month: null }))).toEqual({ legalRate: null, missingFields: ['legal_month'], problems: [] });
    expect(read(usury({ month: 'foo' }))).toEqual({ legalRate: null, missingFields: [], problems: ['legal_invalid_month'] });
  });
});

describe('readLegalRate: SMMLV', () => {
  it('records whole pesos for the whole year, with the modality all', () => {
    expect(read({ kind: 'smmlv', value: 1750905, year: 2027 })).toEqual({
      legalRate: { kind: 'smmlv', modality: 'all', validFrom: '2027-01-01', validTo: '2027-12-31', value: 1750905 },
      missingFields: [],
      problems: [],
    });
  });

  it('defaults to this year, ignores a month and a modality, and does not ask for them', () => {
    expect(read({ kind: 'smmlv', value: 1800000, modality: 'consumer', month: 'marzo' }).legalRate).toEqual({ kind: 'smmlv', modality: 'all', validFrom: '2026-01-01', validTo: '2026-12-31', value: 1800000 });
  });

  it.each([1750.9, 99999, 100000001, 1750905.5, '1750905'])('refuses the SMMLV %s', (value) => {
    expect(read({ kind: 'smmlv', value, year: 2027 })).toEqual({ legalRate: null, missingFields: [], problems: ['legal_smmlv_out_of_range'] });
  });

  it('refuses a year that is not a real year', () => {
    expect(read({ kind: 'smmlv', value: 1750905, year: 1800 }).problems).toEqual(['legal_invalid_month']);
  });
});

describe('readLegalRate: what is missing', () => {
  it('asks for the kind and the value when the model found neither', () => {
    expect(read(null)).toEqual({ legalRate: null, missingFields: ['legal_kind', 'legal_value'], problems: [] });
    expect(read({ kind: 'cripto', value: null })).toEqual({ legalRate: null, missingFields: ['legal_kind', 'legal_value'], problems: [] });
  });

  it('asks only for the value when the rest is known', () => {
    expect(read(usury({ value: null }))).toEqual({ legalRate: null, missingFields: ['legal_value'], problems: [] });
    expect(read({ kind: 'smmlv', value: null })).toEqual({ legalRate: null, missingFields: ['legal_value'], problems: [] });
  });
});

describe('previewLegalRate', () => {
  const draft = (extra = {}) => ({ kind: 'usury', modality: 'consumer', validFrom: '2026-11-01', validTo: '2026-11-30', value: 2820, ...extra });

  it('echoes the kind, modality, month and value, and says nothing is saved yet', () => {
    const text = previewLegalRate(draft());

    expect(text).toContain('Tasa de usura');
    expect(text).toContain('Modalidad: consumo y ordinario');
    expect(text).toContain('Mes: noviembre de 2026');
    expect(text).toContain('Valor: 28.20% E.A.');
    expect(text).toContain('no se guarda hasta que confirmes');
    expect(text).not.toContain('IBC');
  });

  it('shows the usury cap an IBC implies (IBC x 1.5, half up) for a non mortgage modality', () => {
    const text = previewLegalRate(draft({ kind: 'ibc', value: 1949 }));

    expect(text).toContain('IBC');
    expect(text).toContain('Valor: 19.49% E.A.');
    expect(text).toContain('Tope de usura que resulta: 29.24% E.A.');
    expect(previewLegalRate(draft({ kind: 'ibc', value: 1906 }))).toContain('Tope de usura que resulta: 28.59% E.A.');
  });

  it('never shows a derived cap for a mortgage, even for a stored IBC draft', () => {
    const text = previewLegalRate(draft({ kind: 'ibc', modality: 'mortgage', value: 1949 }));

    expect(text).toContain('Valor: 19.49% E.A.');
    expect(text).not.toContain('Tope de usura que resulta');
  });

  it('names each modality in Spanish', () => {
    expect(previewLegalRate(draft({ modality: 'mortgage' }))).toContain('Modalidad: hipotecario');
    expect(previewLegalRate(draft({ modality: 'productive_rural' }))).toContain('Modalidad: productivo rural');
  });

  it('shows the SMMLV in pesos for the year', () => {
    const text = previewLegalRate({ kind: 'smmlv', modality: 'all', validFrom: '2027-01-01', validTo: '2027-12-31', value: 1750905 }).replace(/ /g, ' ');

    expect(text).toContain('Salario mínimo');
    expect(text).toContain('Año: 2027');
    expect(text).toContain('Valor: $ 1.750.905');
    expect(text).not.toContain('Modalidad');
  });
});

describe('isStorableLegalRate (what Confirm re-checks in a pending it did not just build)', () => {
  const row = (extra = {}) => ({ kind: 'usury', modality: 'consumer', validFrom: '2026-11-01', validTo: '2026-11-30', value: 2820, ...extra });

  it('accepts what readLegalRate produces', () => {
    expect(isStorableLegalRate(row())).toBe(true);
    expect(isStorableLegalRate(read(usury()).legalRate)).toBe(true);
    expect(isStorableLegalRate({ kind: 'smmlv', modality: 'all', validFrom: '2027-01-01', validTo: '2027-12-31', value: 1750905 })).toBe(true);
  });

  it.each([
    ['a value out of range', row({ value: 50 })],
    ['an unknown kind', row({ kind: 'mora' })],
    ['an unknown modality', row({ modality: 'cripto' })],
    ['an IBC for a mortgage', row({ kind: 'ibc', modality: 'mortgage' })],
    ['an SMMLV with a modality', { kind: 'smmlv', modality: 'consumer', validFrom: '2027-01-01', validTo: '2027-12-31', value: 1750905 }],
    ['a period that is not the whole month', row({ validTo: '2026-11-15' })],
    ['a period that does not start on day 1', row({ validFrom: '2026-11-02' })],
    ['no draft at all', null],
  ])('refuses %s', (_label, draft) => {
    expect(isStorableLegalRate(draft)).toBe(false);
  });
});

describe('describeLegalRate', () => {
  it('names the rate with its article, modality, month and value', () => {
    expect(describeLegalRate({ kind: 'usury', modality: 'consumer', validFrom: '2026-11-01', validTo: '2026-11-30', value: 2820 })).toBe('la tasa de usura (consumo y ordinario) de noviembre de 2026: 28.20% E.A.');
    expect(describeLegalRate({ kind: 'ibc', modality: 'consumer', validFrom: '2026-12-01', validTo: '2026-12-31', value: 1949 })).toBe('el IBC (consumo y ordinario) de diciembre de 2026: 19.49% E.A.');
  });

  it('names the SMMLV by year', () => {
    expect(describeLegalRate({ kind: 'smmlv', modality: 'all', validFrom: '2027-01-01', validTo: '2027-12-31', value: 1750905 }).replace(/ /g, ' ')).toBe('el salario mínimo de 2027: $ 1.750.905');
  });
});
