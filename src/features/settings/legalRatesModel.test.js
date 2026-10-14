import { resolveLegal } from '@finance-core';
import { describe, expect, it } from 'vitest';
import {
  buildLegalRatesView, existingEntry, isPastMonth, modalityLabel, monthPeriod, parsePercentBp, parsePesos,
  toRateRow, toSmmlvRow, validateRateDraft, validateSmmlvDraft, yearPeriod,
} from './legalRatesModel';

const ibcNov = { kind: 'ibc', modality: 'consumer', validFrom: '2026-11-01', validTo: '2026-11-30', value: 1949, source: '', verified: false };
const mortgageNov = { kind: 'usury', modality: 'mortgage', validFrom: '2026-11-01', validTo: '2026-11-30', value: 2200, source: 'Resolución', verified: true };

describe('parsePercentBp', () => {
  it.each([
    ['19,49', 1949],
    ['19.49', 1949],
    ['19', 1900],
    ['19,5', 1950],
    [' 28,59 % ', 2859],
    ['0,05', 5],
    ['19,', 1900],
    // 1.15 * 100 is 114.99999999999999 in floating point: the parser must stay in integer arithmetic.
    ['1,15', 115],
    ['29,24', 2924],
  ])('reads %j as %i basis points', (text, expected) => {
    expect(parsePercentBp(text)).toBe(expected);
  });

  it.each(['', '   ', 'abc', '1.949', '19,495', '1,2,3', '-5', '19e2', ',5', '1234'])('refuses %j', (text) => {
    expect(parsePercentBp(text)).toBeNull();
  });
});

describe('parsePesos', () => {
  it.each([
    ['1750905', 1750905],
    ['1.750.905', 1750905],
    ['$ 1.750.905', 1750905],
    ['1,750,905', 1750905],
    ['200000', 200000],
  ])('reads %j as %i pesos', (text, expected) => {
    expect(parsePesos(text)).toBe(expected);
  });

  it.each(['', 'abc', '1.75', '12.34', '-1', '1.750,5', '1..000'])('refuses %j', (text) => {
    expect(parsePesos(text)).toBeNull();
  });
});

describe('periods and helpers', () => {
  it.each([['2026-11', '2026-11-30'], ['2026-02', '2026-02-28'], ['2028-02', '2028-02-29'], ['2026-12', '2026-12-31']])('spans the whole month of %s', (month, validTo) => {
    expect(monthPeriod(month)).toEqual({ validFrom: `${month}-01`, validTo });
  });

  it('spans the whole year', () => {
    expect(yearPeriod(2027)).toEqual({ validFrom: '2027-01-01', validTo: '2027-12-31' });
  });

  it('flags only months before the current one as past', () => {
    expect(isPastMonth('2026-09', '2026-10-14')).toBe(true);
    expect(isPastMonth('2026-10', '2026-10-14')).toBe(false);
    expect(isPastMonth('2026-11', '2026-10-14')).toBe(false);
  });

  it('names modalities in Spanish and falls back to the raw key', () => {
    expect(modalityLabel('consumer')).toBe('Consumo y ordinario');
    expect(modalityLabel('mortgage')).toBe('Hipotecario');
    expect(modalityLabel('whatever')).toBe('whatever');
  });
});

describe('validateRateDraft', () => {
  const draft = (overrides = {}) => ({ kind: 'ibc', modality: 'consumer', month: '2026-11', valueText: '19,49', ...overrides });

  it('derives usury 29,24 from an IBC of 19,49 before saving', () => {
    expect(validateRateDraft(draft())).toMatchObject({ ok: true, valueBp: 1949, usuryBp: 2924, usuryLabel: '29,24', errors: {} });
  });

  it('accepts a dot decimal and rounds the derived usury half up', () => {
    expect(validateRateDraft(draft({ valueText: '19.06' }))).toMatchObject({ ok: true, valueBp: 1906, usuryBp: 2859, usuryLabel: '28,59' });
  });

  it('reads a usury cap as written and derives nothing', () => {
    expect(validateRateDraft(draft({ kind: 'usury', valueText: '29,24' }))).toMatchObject({ ok: true, valueBp: 2924, usuryBp: null, usuryLabel: null });
  });

  it.each(['4', '101', '0,05'])('refuses %j as out of range with an inline message', (valueText) => {
    const result = validateRateDraft(draft({ valueText }));
    expect(result.ok).toBe(false);
    expect(result.errors.value).toBe('La tasa debe estar entre 5,00 % y 100,00 % E.A.');
  });

  it('explains a value that is not a percentage', () => {
    const result = validateRateDraft(draft({ valueText: '19,495' }));
    expect(result.ok).toBe(false);
    expect(result.errors.value).toBe('Escribe la tasa como porcentaje, por ejemplo 19,49.');
  });

  it('stays quiet but not savable while the value is empty', () => {
    expect(validateRateDraft(draft({ valueText: '' }))).toMatchObject({ ok: false, errors: {}, usuryBp: null });
  });

  it('requires a valid month', () => {
    expect(validateRateDraft(draft({ month: '' }))).toMatchObject({ ok: false, errors: { month: 'Elige el mes de la tasa.' } });
    expect(validateRateDraft(draft({ month: '2026-13' })).ok).toBe(false);
  });

  it('requires an explicit usury for mortgage and never derives it from an IBC', () => {
    const refused = validateRateDraft(draft({ modality: 'mortgage' }));
    expect(refused.ok).toBe(false);
    expect(refused.errors.kind).toBe('Para hipotecario escribe la usura: el IBC no la deriva.');
    expect(validateRateDraft(draft({ modality: 'mortgage', kind: 'usury', valueText: '22' }))).toMatchObject({ ok: true, valueBp: 2200 });
  });
});

describe('validateSmmlvDraft', () => {
  it('reads the year and the pesos', () => {
    expect(validateSmmlvDraft({ year: '2027', valueText: '1.900.000' })).toMatchObject({ ok: true, year: 2027, valuePesos: 1900000, errors: {} });
  });

  it('refuses a year that is not four digits', () => {
    expect(validateSmmlvDraft({ year: '27', valueText: '1.900.000' })).toMatchObject({ ok: false, errors: { year: 'Escribe un año de cuatro cifras.' } });
  });

  it.each(['50.000', '200.000.000'])('refuses %j as out of range', (valueText) => {
    expect(validateSmmlvDraft({ year: '2027', valueText })).toMatchObject({ ok: false, errors: { value: 'El salario mínimo debe estar entre $ 100.000 y $ 100.000.000.' } });
  });

  it('stays quiet but not savable while the value is empty', () => {
    expect(validateSmmlvDraft({ year: '2027', valueText: '' })).toMatchObject({ ok: false, errors: {} });
  });
});

describe('row builders', () => {
  it('builds the stored IBC row with a whole-month period and the optional source', () => {
    const draft = { kind: 'ibc', modality: 'consumer', month: '2026-11', valueText: '19,49' };
    expect(toRateRow(draft, { source: ' Resolución 1472 ', verified: true })).toEqual({
      kind: 'ibc', modality: 'consumer', validFrom: '2026-11-01', validTo: '2026-11-30', value: 1949, source: 'Resolución 1472', verified: true,
    });
  });

  it('builds the stored SMMLV row for the whole year with modality all', () => {
    expect(toSmmlvRow({ year: '2027', valueText: '1.900.000' }, { source: '', verified: false })).toEqual({
      kind: 'smmlv', modality: 'all', validFrom: '2027-01-01', validTo: '2027-12-31', value: 1900000, source: '', verified: false,
    });
  });
});

describe('buildLegalRatesView', () => {
  const legal = resolveLegal([ibcNov, mortgageNov]);
  const texts = (badges) => badges.map((badge) => badge.text);

  it('groups by modality in the app order, newest month first', () => {
    const view = buildLegalRatesView(legal, '2026-11-15');

    expect(view.groups.map((group) => group.modality)).toEqual(['consumer', 'mortgage']);
    expect(view.groups[0]).toMatchObject({ label: 'Consumo y ordinario' });
    expect(view.groups[0].rows.map((row) => row.month)).toEqual(['2026-11', '2026-10']);
  });

  it('badges a derived cap, an unverified row and an app value', () => {
    const [group] = buildLegalRatesView(legal, '2026-11-15').groups;
    const [nov, oct] = group.rows;

    expect(nov).toMatchObject({ monthLabel: 'noviembre de 2026', capEA: 29.24, ibcEA: 19.49 });
    expect(texts(nov.badges)).toEqual(['Derivada del IBC', 'Sin verificar']);
    expect(oct).toMatchObject({ capEA: 28.59 });
    expect(texts(oct.badges)).toEqual(['Valor de la app']);
  });

  it('badges a manual cap and keeps the IBC beside it', () => {
    const manual = { kind: 'usury', modality: 'consumer', validFrom: '2026-11-01', validTo: '2026-11-30', value: 2900, source: 'x', verified: true };
    const [group] = buildLegalRatesView(resolveLegal([ibcNov, manual]), '2026-11-15').groups;

    expect(group.rows[0]).toMatchObject({ capEA: 29, ibcEA: 19.49 });
    expect(texts(group.rows[0].badges)).toEqual(['Usura manual']);
  });

  it('shows no stale prompt while the current month is covered', () => {
    const view = buildLegalRatesView(legal, '2026-11-15');

    expect(view.groups.map((group) => group.stale)).toEqual([null, null]);
  });

  it('carries the latest cap into a month with no row and says which month it uses', () => {
    const view = buildLegalRatesView(legal, '2026-12-10');
    const [consumer, mortgage] = view.groups;

    expect(consumer.stale).toEqual({
      currentMonth: '2026-12', currentLabel: 'diciembre de 2026', capEA: 29.24, usingMonth: '2026-11', badge: 'Desactualizada: usando la de noviembre de 2026',
    });
    expect(mortgage.stale).toMatchObject({ capEA: 22, badge: 'Desactualizada: usando la de noviembre de 2026' });
  });

  it('lists the code defaults when the household has no rows', () => {
    const view = buildLegalRatesView(resolveLegal([]), '2026-10-14');

    expect(view.groups).toHaveLength(1);
    expect(view.groups[0].rows).toHaveLength(1);
    expect(view.groups[0]).toMatchObject({ modality: 'consumer', stale: null });
    expect(texts(view.groups[0].rows[0].badges)).toEqual(['Valor de la app']);
  });

  it('asks for a mortgage cap until one is entered', () => {
    expect(buildLegalRatesView(resolveLegal([]), '2026-10-14').mortgageCapMissing).toBe(true);
    expect(buildLegalRatesView(legal, '2026-11-15').mortgageCapMissing).toBe(false);
  });

  it('lists the SMMLV by year, newest first, and flags a missing current year as stale', () => {
    const smmlv = { kind: 'smmlv', modality: 'all', validFrom: '2027-01-01', validTo: '2027-12-31', value: 1900000, source: '', verified: false };
    const withTwo = buildLegalRatesView(resolveLegal([smmlv]), '2027-03-01');
    const defaultsOnly = buildLegalRatesView(resolveLegal([]), '2027-03-01');

    expect(withTwo.smmlv.rows.map((row) => row.year)).toEqual([2027, 2026]);
    expect(withTwo.smmlv.rows[0]).toMatchObject({ valueMinor: 1900000 });
    expect(texts(withTwo.smmlv.rows[0].badges)).toEqual(['Sin verificar']);
    expect(texts(withTwo.smmlv.rows[1].badges)).toEqual(['Valor de la app']);
    expect(withTwo.smmlv.stale).toBeNull();
    expect(defaultsOnly.smmlv.stale).toEqual({ currentYear: 2027, usingYear: 2026, valueMinor: 1750905, badge: 'Desactualizado: usando el de 2026' });
  });
});

describe('existingEntry', () => {
  const legal = resolveLegal([ibcNov]);

  it('finds the entry stored for a modality and month, with its origin', () => {
    expect(existingEntry(legal, 'consumer', '2026-11')).toMatchObject({ origin: 'ibc' });
    expect(existingEntry(legal, 'consumer', '2026-10')).toMatchObject({ origin: 'default' });
  });

  it('returns null when nothing is stored', () => {
    expect(existingEntry(legal, 'consumer', '2027-01')).toBeNull();
    expect(existingEntry(legal, 'mortgage', '2026-11')).toBeNull();
  });
});
