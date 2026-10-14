// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEGAL,
  LEGAL_MODALITIES,
  capOn,
  ley1555Notice,
  legalOf,
  resolveLegal,
  smmlvFor,
  usuryFromIbcBp,
  usuryNotice,
} from '../src/legal.js';
import { project, registerProjector } from '../src/ledger/project.js';
import { normalizeRate } from '../src/rates.js';

const ea = (value) => normalizeRate({ convention: 'EA', value });
const month = (kind, modality, from, to, value, extra = {}) => ({ kind, modality, validFrom: from, validTo: to, value, source: 'test', verified: true, ...extra });
const ibc = (modality, from, to, value, extra) => month('ibc', modality, from, to, value, extra);
const usury = (modality, from, to, value, extra) => month('usury', modality, from, to, value, extra);
const smmlv = (year, value) => month('smmlv', 'all', `${year}-01-01`, `${year}-12-31`, value);
const NOV = ['2026-11-01', '2026-11-30'];
const OCT = ['2026-10-01', '2026-10-31'];
const entryFor = (table, modality, validFrom) => table.find((entry) => entry.modality === modality && entry.validFrom === validFrom);

describe('LEGAL_MODALITIES', () => {
  it('lists the eight known modalities', () => {
    expect([...LEGAL_MODALITIES]).toEqual([
      'consumer',
      'low_amount',
      'productive',
      'productive_rural',
      'productive_urban',
      'popular_rural',
      'popular_urban',
      'mortgage',
    ]);
  });
});

describe('usuryFromIbcBp', () => {
  it('derives 1.5 x IBC in basis points: 1949 gives 2924 and 1906 gives 2859 (half up)', () => {
    expect(usuryFromIbcBp(1949)).toBe(2924);
    expect(usuryFromIbcBp(1906)).toBe(2859);
  });

  it('rounds an exact half up and leaves even values exact', () => {
    expect(usuryFromIbcBp(1901)).toBe(2852); // 2851.5 -> 2852
    expect(usuryFromIbcBp(1900)).toBe(2850);
    expect(usuryFromIbcBp(1000)).toBe(1500);
  });
});

describe('resolveLegal: derivation and override (LR2)', () => {
  it('derives the cap from an IBC row and echoes the IBC: 19.49 gives 29.24', () => {
    const { usuryTable } = resolveLegal([ibc('consumer', ...NOV, 1949)]);
    expect(entryFor(usuryTable, 'consumer', NOV[0])).toMatchObject({
      modality: 'consumer',
      validFrom: NOV[0],
      validTo: NOV[1],
      capEA: 29.24,
      origin: 'ibc',
      ibcEA: 19.49,
      source: 'test',
      verified: true,
    });
  });

  it('rounds half up: IBC 19.06 gives exactly 28.59', () => {
    const { usuryTable } = resolveLegal([ibc('consumer', ...NOV, 1906)]);
    expect(entryFor(usuryTable, 'consumer', NOV[0]).capEA).toBe(28.59);
  });

  it('lets an explicit usury row win over the derived value for the same modality and month', () => {
    const { usuryTable } = resolveLegal([ibc('consumer', ...NOV, 1949), usury('consumer', ...NOV, 2900)]);
    const entries = usuryTable.filter((entry) => entry.modality === 'consumer' && entry.validFrom === NOV[0]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ capEA: 29, origin: 'override' });
  });

  it('keeps an IBC row for another month independent of the override', () => {
    const { usuryTable } = resolveLegal([usury('consumer', ...NOV, 2900), ibc('consumer', '2026-12-01', '2026-12-31', 1949)]);
    expect(entryFor(usuryTable, 'consumer', NOV[0])).toMatchObject({ capEA: 29, origin: 'override' });
    expect(entryFor(usuryTable, 'consumer', '2026-12-01')).toMatchObject({ capEA: 29.24, origin: 'ibc' });
  });

  it('does not derive a mortgage cap from an IBC row, but honours an explicit mortgage usury row', () => {
    const onlyIbc = resolveLegal([ibc('mortgage', ...NOV, 1500)]);
    expect(onlyIbc.usuryTable.filter((entry) => entry.modality === 'mortgage')).toEqual([]);
    expect(capOn(onlyIbc.usuryTable, 'mortgage', '2026-11-15')).toBeNull();
    const manual = resolveLegal([ibc('mortgage', ...NOV, 1500), usury('mortgage', ...NOV, 2400)]);
    expect(entryFor(manual.usuryTable, 'mortgage', NOV[0])).toMatchObject({ capEA: 24, origin: 'override' });
  });
});

describe('resolveLegal: defaults and precedence (LR3, LR4)', () => {
  it('returns the code defaults for empty rows: cap 28.59 and SMMLV 2026 = 1,750,905', () => {
    const resolved = resolveLegal([]);
    expect(resolved.status).toBe('defaults');
    expect(resolved.usuryTable).toEqual([
      expect.objectContaining({ modality: 'consumer', validFrom: OCT[0], validTo: OCT[1], capEA: 28.59, origin: 'default', verified: true }),
    ]);
    expect(resolved.smmlvTable).toEqual([expect.objectContaining({ year: 2026, valueMinor: 1_750_905, origin: 'default', verified: true })]);
  });

  it('treats missing or non-array rows as empty and never throws', () => {
    expect(resolveLegal(undefined).status).toBe('defaults');
    expect(resolveLegal(null).usuryTable).toHaveLength(1);
    expect(resolveLegal('nope').smmlvTable).toHaveLength(1);
  });

  it('lets a household usury row beat the code default for the same month', () => {
    const { usuryTable } = resolveLegal([usury('consumer', ...OCT, 2900)]);
    expect(usuryTable.filter((entry) => entry.modality === 'consumer' && entry.validFrom === OCT[0])).toHaveLength(1);
    expect(capOn(usuryTable, 'consumer', '2026-10-15')).toMatchObject({ capEA: 29, stale: false });
  });

  it('keeps defaults for months the household did not enter and reports status table', () => {
    const resolved = resolveLegal([ibc('consumer', ...NOV, 1949)]);
    expect(resolved.status).toBe('table');
    expect(resolved.usuryTable.map((entry) => [entry.validFrom, entry.origin])).toEqual([
      [OCT[0], 'default'],
      [NOV[0], 'ibc'],
    ]);
  });

  it('orders the table by modality then month, whatever the row order', () => {
    const resolved = resolveLegal([
      usury('mortgage', ...NOV, 2400),
      usury('consumer', '2026-12-01', '2026-12-31', 2800),
      ibc('consumer', ...NOV, 1949),
    ]);
    expect(resolved.usuryTable.map((entry) => `${entry.modality}:${entry.validFrom}`)).toEqual([
      'consumer:2026-10-01',
      'consumer:2026-11-01',
      'consumer:2026-12-01',
      'mortgage:2026-11-01',
    ]);
  });

  it('ignores rows of an unknown kind or modality, malformed dates, non-integers and out-of-range values', () => {
    const rows = [
      month('inflation', 'consumer', ...NOV, 1949),
      ibc('microcredit', ...NOV, 1949),
      ibc('consumer', 'soon', NOV[1], 1949),
      ibc('consumer', ...NOV, 19.49),
      ibc('consumer', ...NOV, 280),
      usury('consumer', ...NOV, 20_000),
      smmlv(2027, 50),
      null,
    ];
    const resolved = resolveLegal(rows);
    expect(resolved.status).toBe('defaults');
    expect(resolved.usuryTable).toHaveLength(1);
    expect(resolved.smmlvTable).toHaveLength(1);
  });

  it('lets a household SMMLV row beat the default for its year and adds other years in order', () => {
    const { smmlvTable } = resolveLegal([smmlv(2027, 1_900_000), smmlv(2026, 1_800_000)]);
    expect(smmlvTable).toEqual([
      expect.objectContaining({ year: 2026, valueMinor: 1_800_000, origin: 'override' }),
      expect.objectContaining({ year: 2027, valueMinor: 1_900_000, origin: 'override' }),
    ]);
  });

  it('accepts injected defaults instead of the code tables and marks their origin', () => {
    const defaults = {
      usuryTable: [{ modality: 'consumer', validFrom: NOV[0], validTo: NOV[1], capEA: 27.1, source: 'fixture', verified: false }],
      smmlvTable: [{ year: 2030, valueMinor: 2_500_000, source: 'fixture', verified: false }],
    };
    const resolved = resolveLegal([], defaults);
    expect(resolved.usuryTable).toEqual([expect.objectContaining({ capEA: 27.1, origin: 'default', verified: false })]);
    expect(resolved.smmlvTable).toEqual([expect.objectContaining({ year: 2030, valueMinor: 2_500_000, origin: 'default' })]);
  });

  it('marks the unavailable fallback: code tables with status unavailable', () => {
    const fallback = resolveLegal.unavailable();
    expect(fallback.status).toBe('unavailable');
    expect(fallback.usuryTable).toEqual(DEFAULT_LEGAL.usuryTable);
    expect(fallback.smmlvTable).toEqual(DEFAULT_LEGAL.smmlvTable);
    expect(resolveLegal.unavailable({ usuryTable: [], smmlvTable: [] })).toEqual({ usuryTable: [], smmlvTable: [], status: 'unavailable' });
  });
});

describe('capOn (LR5)', () => {
  const table = resolveLegal([]).usuryTable;

  it('returns the cap whose month covers the date, not stale', () => {
    const found = capOn(table, 'consumer', '2026-10-15');
    expect(found).toMatchObject({ capEA: 28.59, stale: false });
    expect(found.entry).toMatchObject({ validFrom: OCT[0], validTo: OCT[1] });
    expect(capOn(table, 'consumer', '2026-10-31')).toMatchObject({ capEA: 28.59, stale: false });
  });

  it('carries the latest earlier cap forward with stale and lastValidTo', () => {
    expect(capOn(table, 'consumer', '2026-12-05')).toMatchObject({ capEA: 28.59, stale: true, lastValidTo: OCT[1] });
  });

  it('carries the most recent earlier cap when several exist, including across a gap', () => {
    const rows = resolveLegal([usury('consumer', ...NOV, 2700), usury('consumer', '2027-01-01', '2027-01-31', 2600)]).usuryTable;
    expect(capOn(rows, 'consumer', '2026-12-20')).toMatchObject({ capEA: 27, stale: true, lastValidTo: NOV[1] });
    expect(capOn(rows, 'consumer', '2027-03-01')).toMatchObject({ capEA: 26, stale: true, lastValidTo: '2027-01-31' });
  });

  it('returns null before the first cap, for another modality, and never throws on bad input', () => {
    expect(capOn(table, 'consumer', '2026-01-15')).toBeNull();
    expect(capOn(table, 'mortgage', '2026-10-15')).toBeNull();
    expect(capOn(table, 'consumer', 'not-a-date')).toBeNull();
    expect(capOn(undefined, 'consumer', '2026-10-15')).toBeNull();
    expect(capOn([], 'consumer', '2026-10-15')).toBeNull();
  });
});

describe('smmlvFor (LR3)', () => {
  const table = resolveLegal([]).smmlvTable;

  it('returns the value of the year', () => {
    expect(smmlvFor(table, 2026)).toEqual({ valueMinor: 1_750_905, stale: false });
    expect(smmlvFor(resolveLegal([smmlv(2026, 1_800_000)]).smmlvTable, 2026)).toEqual({ valueMinor: 1_800_000, stale: false });
  });

  it('carries the latest earlier year forward with stale', () => {
    expect(smmlvFor(table, 2028)).toEqual({ valueMinor: 1_750_905, stale: true });
    const two = resolveLegal([smmlv(2027, 1_900_000)]).smmlvTable;
    expect(smmlvFor(two, 2029)).toEqual({ valueMinor: 1_900_000, stale: true });
  });

  it('returns null before the first known year or for a bad input, without throwing', () => {
    expect(smmlvFor(table, 2025)).toBeNull();
    expect(smmlvFor(table, 'x')).toBeNull();
    expect(smmlvFor(undefined, 2026)).toBeNull();
  });
});

describe('legalOf (LR4 precedence)', () => {
  const household = resolveLegal([usury('consumer', ...OCT, 2900)]);
  const option = resolveLegal([usury('consumer', ...OCT, 2750)]);

  it('prefers opts.legal, then debt.legal, then the code tables', () => {
    expect(legalOf({ legal: household }, { legal: option })).toBe(option);
    expect(legalOf({ legal: household }, {})).toBe(household);
    expect(legalOf({}, undefined)).toBe(DEFAULT_LEGAL);
    expect(legalOf(undefined, undefined)).toBe(DEFAULT_LEGAL);
  });

  it('resolves the cap from the chosen tables: option 27.50 beats decoration 29.00 beats code 28.59', () => {
    const capFor = (debt, opts) => capOn(legalOf(debt, opts).usuryTable, 'consumer', '2026-10-15').capEA;
    expect(capFor({ legal: household }, { legal: option })).toBe(27.5);
    expect(capFor({ legal: household }, {})).toBe(29);
    expect(capFor({}, {})).toBe(28.59);
  });

  it('is what project() hands to a registered projector as `legal`', () => {
    const seen = [];
    registerProjector('vehicle', (context) => {
      seen.push(context.legal);
      return { notices: [] };
    });
    try {
      const debt = { $id: 'd1', terms: { kind: 'vehicle', principalMinor: 1_000_000, openedOn: '2026-01-15', rate: ea(24), system: 'french', periodicity: 'monthly', n: 12, firstDueOn: '2026-02-15' } };
      project(debt, [], '2026-03-01');
      project({ ...debt, legal: household }, [], '2026-03-01');
      project({ ...debt, legal: household }, [], '2026-03-01', { legal: option });
    } finally {
      registerProjector('vehicle', null);
    }
    expect(seen).toEqual([DEFAULT_LEGAL, household, option]);
  });
});

describe('usuryNotice with the resolved table and the stale cap (AD7, IR1)', () => {
  const OCT_ONLY = resolveLegal([]).usuryTable;

  it('warns with stale true and lastValidTo when only the 2026-10 cap exists and the date is in 2026-12', () => {
    const notice = usuryNotice(ea(30), 'consumer', '2026-12-05', { usuryTable: OCT_ONLY });
    expect(notice).toMatchObject({ code: 'usury_above_cap', capEA: 28.59, stale: true, lastValidTo: OCT[1], asOf: '2026-12-05', blocking: false });
    expect(notice.message).toContain(OCT[1]);
  });

  it('reports a cap in force as not stale and carries no lastValidTo', () => {
    const notice = usuryNotice(ea(30), 'consumer', '2026-10-12', { usuryTable: OCT_ONLY });
    expect(notice.stale).toBe(false);
    expect(notice.lastValidTo).toBeUndefined();
  });

  it('uses the code tables by default, so a December date warns against the carried October cap', () => {
    expect(usuryNotice(ea(30), 'consumer', '2026-12-05')).toMatchObject({ capEA: 28.59, stale: true });
  });

  it('returns null when there is no cap at all: before the first cap, another modality, an empty table', () => {
    expect(usuryNotice(ea(99), 'consumer', '2026-01-15', { usuryTable: OCT_ONLY })).toBeNull();
    expect(usuryNotice(ea(99), 'mortgage', '2026-12-05', { usuryTable: OCT_ONLY })).toBeNull();
    expect(usuryNotice(ea(99), 'consumer', '2026-12-05', { usuryTable: [] })).toBeNull();
  });

  it('an injected household cap of 29.00 beats the code cap of 28.59', () => {
    const { usuryTable } = resolveLegal([usury('consumer', ...OCT, 2900)]);
    expect(usuryNotice(ea(29.5), 'consumer', '2026-10-15', { usuryTable })).toMatchObject({ capEA: 29, stale: false });
    expect(usuryNotice(ea(28.8), 'consumer', '2026-10-15', { usuryTable })).toBeNull();
    expect(usuryNotice(ea(28.8), 'consumer', '2026-10-15', { usuryTable: OCT_ONLY })).toMatchObject({ capEA: 28.59 });
  });

  it('a derived cap works too: IBC 19.49 caps November at 29.24', () => {
    const { usuryTable } = resolveLegal([ibc('consumer', ...NOV, 1949)]);
    expect(usuryNotice(ea(29.3), 'consumer', '2026-11-20', { usuryTable })).toMatchObject({ capEA: 29.24, stale: false });
    expect(usuryNotice(ea(29.2), 'consumer', '2026-11-20', { usuryTable })).toBeNull();
  });
});

describe('ley1555Notice threshold (PA1)', () => {
  const mortgage = (principalMinor, extra = {}) => ({ kind: 'mortgage', principalMinor, openedOn: '2026-10-13', ...extra });

  it('states 880 x SMMLV from the code table and a principal of 300,000,000 within it', () => {
    const notice = ley1555Notice(mortgage(300_000_000), '2026-10-13');
    expect(notice).toMatchObject({
      code: 'ley1555_scope_unverified',
      scopeVerified: false,
      blocking: false,
      asOf: '2026-10-13',
      smmlvMinor: 1_750_905,
      thresholdMinor: 1_540_796_400,
      aboveThreshold: false,
      smmlvStale: false,
    });
    expect(notice.message).toContain('unverified');
  });

  it('flags a principal above the threshold, and treats exactly the threshold as within it', () => {
    expect(ley1555Notice(mortgage(2_000_000_000), '2026-10-13')).toMatchObject({ aboveThreshold: true, thresholdMinor: 1_540_796_400 });
    expect(ley1555Notice(mortgage(1_540_796_400), '2026-10-13').aboveThreshold).toBe(false);
    expect(ley1555Notice(mortgage(1_540_796_401), '2026-10-13').aboveThreshold).toBe(true);
  });

  it('uses the household SMMLV when one is injected: 1,800,000 gives 1,584,000,000', () => {
    const { smmlvTable } = resolveLegal([smmlv(2026, 1_800_000)]);
    expect(ley1555Notice(mortgage(300_000_000), '2026-10-13', { smmlvTable })).toMatchObject({ smmlvMinor: 1_800_000, thresholdMinor: 1_584_000_000, aboveThreshold: false });
  });

  it('carries the latest SMMLV forward for a later year and says so', () => {
    expect(ley1555Notice(mortgage(300_000_000), '2027-02-01')).toMatchObject({ smmlvMinor: 1_750_905, smmlvStale: true, thresholdMinor: 1_540_796_400 });
  });

  it('keeps the notice without a threshold when the principal or the SMMLV is unknown', () => {
    expect(ley1555Notice({ kind: 'mortgage' }, '2026-10-13')).toMatchObject({ thresholdMinor: 1_540_796_400, aboveThreshold: null });
    const noSmmlv = ley1555Notice(mortgage(300_000_000), '2026-10-13', { smmlvTable: [] });
    expect(noSmmlv).toMatchObject({ code: 'ley1555_scope_unverified', thresholdMinor: null, aboveThreshold: null });
    expect(ley1555Notice(mortgage(300_000_000), '2024-10-13')).toMatchObject({ thresholdMinor: null, aboveThreshold: null });
  });

  it('is still raised only for mortgages and never throws on bad input', () => {
    expect(ley1555Notice({ kind: 'consumer', principalMinor: 1 }, '2026-10-13')).toBeNull();
    expect(ley1555Notice(undefined, '2026-10-13')).toBeNull();
    expect(ley1555Notice(mortgage(300_000_000), 'soon')).toBeNull();
  });
});
